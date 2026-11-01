import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import {
  ADMIN_COOKIE_NAME,
  getAdminSessionSecret,
  verifySessionCookie,
} from '../../../../lib/admin';
import {
  extractCloudinaryPublicId,
  getOptimizedCloudinaryUrl,
  listCloudinaryAssets,
} from '../../../../lib/cloudinary';

export const prerender = false;

export interface MediaUsage {
  title: string;
  slug: string;
  type: 'hero' | 'gallery';
}

export interface MediaItem {
  id: string;
  url: string;
  publicId?: string;
  alt: string;
  isCloudinary: boolean;
  thumbUrl: string;
  usages: MediaUsage[];
}

export const GET: APIRoute = async ({ cookies }) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const recipes = await getCollection('recipes');
    const mediaMap = new Map<string, MediaItem>();

    for (const recipe of recipes) {
      const slug = recipe.id.replace(/\.md$/, '');
      const title = recipe.data.title;

      // Primary Hero Image
      const rawImage = recipe.data.image;
      const primaryUrl = typeof rawImage === 'string' ? rawImage : (rawImage as any)?.src;
      if (primaryUrl) {
        const isCloudinary = primaryUrl.includes('res.cloudinary.com');
        const publicId = extractCloudinaryPublicId(primaryUrl) ?? undefined;
        const key = publicId || primaryUrl;
        const thumbUrl = isCloudinary ? getOptimizedCloudinaryUrl(primaryUrl, 360) : primaryUrl;

        if (!mediaMap.has(key)) {
          mediaMap.set(key, {
            id: key,
            url: primaryUrl,
            publicId,
            alt: recipe.data.imageAlt || `${title} photo`,
            isCloudinary,
            thumbUrl,
            usages: [{ title, slug, type: 'hero' }],
          });
        } else {
          const existing = mediaMap.get(key)!;
          if (!existing.usages.some((u) => u.slug === slug && u.type === 'hero')) {
            existing.usages.push({ title, slug, type: 'hero' });
          }
        }
      }

      // Gallery Images
      if (Array.isArray(recipe.data.gallery)) {
        for (const item of recipe.data.gallery) {
          if (!item || !item.url) continue;
          const isCloudinary = item.url.includes('res.cloudinary.com');
          const publicId = item.publicId || extractCloudinaryPublicId(item.url) || undefined;
          const key = publicId || item.url;
          const thumbUrl = isCloudinary ? getOptimizedCloudinaryUrl(item.url, 360) : item.url;

          if (!mediaMap.has(key)) {
            mediaMap.set(key, {
              id: key,
              url: item.url,
              publicId,
              alt: item.alt || `${title} photo`,
              isCloudinary,
              thumbUrl,
              usages: [{ title, slug, type: 'gallery' }],
            });
          } else {
            const existing = mediaMap.get(key)!;
            if (!existing.usages.some((u) => u.slug === slug && u.type === 'gallery')) {
              existing.usages.push({ title, slug, type: 'gallery' });
            }
          }
        }
      }
    }

    // Also load all Cloudinary assets in crockbites/recipes so newly uploaded/unused assets appear
    try {
      const cldResources = await listCloudinaryAssets('crockbites/recipes', 500);
      for (const res of cldResources) {
        const key = res.public_id;
        if (!mediaMap.has(key)) {
          const rawName = (res.public_id.split('/').pop() || '').replace(/[_-]+/g, ' ');
          mediaMap.set(key, {
            id: key,
            url: res.secure_url,
            publicId: res.public_id,
            alt: rawName || 'Recipe photo',
            isCloudinary: true,
            thumbUrl: getOptimizedCloudinaryUrl(res.secure_url, 360),
            usages: [],
          });
        }
      }
    } catch (cldErr) {
      console.warn('[API Images] Cloudinary resource listing skipped:', cldErr);
    }

    const images = Array.from(mediaMap.values());

    return new Response(JSON.stringify({ ok: true, images }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve media library';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
