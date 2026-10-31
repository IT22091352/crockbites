import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
  ensureCsrfToken,
} from '../../../../lib/admin';
import {
  deleteCloudinaryAsset,
  extractCloudinaryPublicId,
  isCloudinaryConfigured,
} from '../../../../lib/cloudinary';

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

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!isCloudinaryConfigured()) {
    return new Response(
      JSON.stringify({ error: 'Cloudinary credentials are not configured on the server.' }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const publicId = typeof body.publicId === 'string' ? body.publicId.trim() : '';

    const PUBLIC_ID_REGEX = /^[a-zA-Z0-9_\-\/]+$/;
    if (!publicId || !PUBLIC_ID_REGEX.test(publicId) || publicId.includes('..')) {
      return new Response(
        JSON.stringify({
          error: 'Invalid "publicId" provided. Public IDs must only contain alphanumeric characters, hyphens, underscores, and slashes without directory traversal.',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    // Safety check: verify no existing recipe currently uses this asset
    const allRecipes = await getCollection('recipes');
    for (const recipe of allRecipes) {
      const rawImage = recipe.data.image;
      const imageUrl = typeof rawImage === 'string' ? rawImage : (rawImage as any)?.src;
      const mainId = extractCloudinaryPublicId(imageUrl);
      if (mainId === publicId) {
        return new Response(
          JSON.stringify({
            error: `Cannot delete asset: image is currently used as the primary photo in recipe "${recipe.data.title}". Remove it from the recipe before deleting.`,
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        );
      }

      if (Array.isArray(recipe.data.gallery)) {
        for (const item of recipe.data.gallery) {
          const gId = item.publicId || extractCloudinaryPublicId(item.url);
          if (gId === publicId) {
            return new Response(
              JSON.stringify({
                error: `Cannot delete asset: image is currently used in the gallery of recipe "${recipe.data.title}". Remove it from the recipe before deleting.`,
              }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            );
          }
        }
      }
    }

    // Asset verified safe to delete
    const result = await deleteCloudinaryAsset(publicId);

    return new Response(
      JSON.stringify({
        message: 'Asset successfully deleted from Cloudinary.',
        publicId,
        result,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete asset';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

