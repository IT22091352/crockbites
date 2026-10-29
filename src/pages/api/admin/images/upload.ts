import type { APIRoute } from 'astro';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
  ensureCsrfToken,
} from '../../../../lib/admin';
import { uploadImageBuffer, isCloudinaryConfigured } from '../../../../lib/cloudinary';

export const prerender = false;

const isAuthorized = async (request: Request, cookies: any) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return null;
  }

  const session = parseAdminSessionCookie(sessionCookie);
  if (!session) return null;

  const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
  if (!(await ensureCsrfToken(request, csrfCookie, secret, session.id))) {
    return null;
  }

  return session;
};

// Allowed image MIME types and limits
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!isCloudinaryConfigured()) {
    return new Response(
      JSON.stringify({
        error: 'Cloudinary is not configured on the server. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    if (!files || files.length === 0) {
      // Check single file fallback 'image'
      const single = formData.get('image') as File | null;
      if (single) files.push(single);
    }

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: 'No image files provided.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Configurable maximum number of images per upload/batch
    const MAX_IMAGES_PER_BATCH = 10;
    if (files.length > MAX_IMAGES_PER_BATCH) {
      return new Response(
        JSON.stringify({ error: `Cannot upload more than ${MAX_IMAGES_PER_BATCH} images at once.` }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const uploaded = [];
    for (const file of files) {
      if (!(file instanceof File)) continue;

      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return new Response(
          JSON.stringify({ error: `Unsupported image format: ${file.type}. Only JPEG, PNG, WebP, and AVIF are allowed.` }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return new Response(
          JSON.stringify({ error: `File "${file.name}" exceeds the maximum allowed size of 8 MB.` }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await uploadImageBuffer(buffer, {
        folder: 'crockbites/recipes',
      });

      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
        originalName: file.name,
      });
    }

    return new Response(JSON.stringify({ images: uploaded }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image upload failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

