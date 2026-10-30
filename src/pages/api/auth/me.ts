import type { APIRoute } from 'astro';
import { listUserFavorites } from '../../../lib/community';
import { jsonResponse, resolveUserSession } from '../../../lib/community-server';
import { USER_CSRF_COOKIE, USER_SESSION_COOKIE, createUserCsrfToken } from '../../../lib/user-auth';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, locals, url }) => {
  const sessionToken = cookies.get(USER_SESSION_COOKIE)?.value;

  // Fast-path unauthenticated guest requests without initializing D1
  if (!sessionToken || sessionToken.length < 32) {
    let csrfToken = cookies.get(USER_CSRF_COOKIE)?.value;
    if (!csrfToken) {
      csrfToken = createUserCsrfToken('guest');
      cookies.set(USER_CSRF_COOKIE, csrfToken, {
        httpOnly: false,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        path: '/',
        maxAge: 60 * 60 * 12,
      });
    }
    return jsonResponse({
      authenticated: false,
      user: null,
      favoriteSlugs: [],
      csrfToken,
    });
  }

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
