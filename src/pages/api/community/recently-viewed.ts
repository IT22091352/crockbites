import type { APIRoute } from 'astro';
import { listRecentlyViewed, recordRecentlyViewed } from '../../../lib/community';
import {
  getPublishedRecipesMap,
  jsonResponse,
  requireAuthenticatedUserApi,
  resolveUserSession,
} from '../../../lib/community-server';
import { USER_CSRF_COOKIE, verifyUserCsrfToken } from '../../../lib/user-auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, false);
  if (!auth.ok) return auth.response;

  const recent = await listRecentlyViewed(auth.db, auth.user.id, 20);
  return jsonResponse({ ok: true, recentlyViewed: recent });
};

export const POST: APIRoute = async ({ request, cookies, locals, url }) => {
  const { db, user, sessionToken } = await resolveUserSession(cookies, locals, url.protocol);
  // Silently ignore for guests or when DB is unconfigured
  if (!db || !user || !sessionToken) {
    return jsonResponse({ ok: true, recorded: false });
  }

  const csrfCookie = cookies.get(USER_CSRF_COOKIE)?.value;
  if (!(await verifyUserCsrfToken(request, csrfCookie, sessionToken))) {
    return jsonResponse({ error: 'CSRF check failed.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const { slugSet } = await getPublishedRecipesMap();
  const res = await recordRecentlyViewed(db, user.id, body.recipeSlug, slugSet);
  return jsonResponse({ ok: true, recorded: res.ok });
};

