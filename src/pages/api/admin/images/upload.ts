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

// Allowed image MIME types and file extensions
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/svg',
  'image/gif',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.svg',
  '.gif',
]);

function isAllowedImage(file: File): boolean {
  if (file.type && ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  const name = file.name || '';
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

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
    const rawFiles = formData.getAll('images');
    const single = formData.get('image');
    if (single && !rawFiles.includes(single)) {
      rawFiles.push(single);
    }

    const files = rawFiles.filter(
      (f): f is File => typeof f === 'object' && f !== null && 'size' in f && (f as File).size > 0
    );

    if (files.length === 0) {
      return new Response(JSON.stringify({ error: 'No image files provided or selected file is empty.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Maximum number of images per batch (supports generous multi-upload)
    const MAX_IMAGES_PER_BATCH = 25;
    if (files.length > MAX_IMAGES_PER_BATCH) {
      return new Response(
        JSON.stringify({ error: `Cannot upload more than ${MAX_IMAGES_PER_BATCH} images at once.` }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const uploaded = [];
    const errors: Array<{ name: string; error: string }> = [];

    for (const file of files) {
      if (!(file instanceof File)) continue;

      if (!isAllowedImage(file)) {
        errors.push({
          name: file.name,
          error: `Unsupported format (${file.type || 'unknown'}). Only JPEG, PNG, WebP, AVIF, SVG, and GIF are allowed.`,
        });
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push({
          name: file.name,
          error: `Exceeds the 8 MB maximum size limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
        });
        continue;
      }

      try {
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
      } catch (uploadErr) {
        errors.push({
          name: file.name,
          error: uploadErr instanceof Error ? uploadErr.message : 'Cloudinary upload failed',
        });
      }
    }

    if (uploaded.length === 0 && errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.error}`).join('; ');
      return new Response(
        JSON.stringify({ error: `Upload failed: ${summary}`, errors }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        images: uploaded,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image upload failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
