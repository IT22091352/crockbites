import type { APIRoute } from 'astro';
import { listUserCollections, listUserFavorites } from '../../../lib/community';
import { jsonResponse, resolveUserSession } from '../../../lib/community-server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, locals, url }) => {
  const { db, user, csrfToken } = await resolveUserSession(cookies, locals, url.protocol);
  if (!user || !db) {
    return jsonResponse({
      authenticated: false,
      user: null,
      favoriteSlugs: [],
      collections: [],
      csrfToken,
    });
  }

  const targetRecipe = url.searchParams.get('recipeSlug') ?? undefined;
  const [favorites, collections] = await Promise.all([
    listUserFavorites(db, user.id),
    listUserCollections(db, user.id, targetRecipe),
  ]);

  return jsonResponse({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
    },
    favoriteSlugs: favorites.map((f) => f.recipeSlug),
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      isPublic: c.isPublic,
      recipeCount: c.recipeCount,
      containsTargetRecipe: c.containsTargetRecipe,
    })),
    csrfToken,
  });
};

