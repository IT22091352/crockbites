import type { APIRoute } from 'astro';
import { listUserFavorites } from '../../../lib/community';
import { jsonResponse, resolveUserSession } from '../../../lib/community-server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, locals, url }) => {
  const { db, user, csrfToken } = await resolveUserSession(cookies, locals, url.protocol);
  if (!user || !db) {
    return jsonResponse({
      authenticated: false,
      user: null,
      favoriteSlugs: [],
      csrfToken,
    });
  }

  const favorites = await listUserFavorites(db, user.id);

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
    csrfToken,
  });
};

