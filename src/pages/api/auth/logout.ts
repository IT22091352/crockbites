import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { jsonResponse } from '../../../lib/community-server';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  clearUserAuthCookies,
  revokeUserSession,
  verifyUserCsrfToken,
} from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const sessionToken = cookies.get(USER_SESSION_COOKIE)?.value;
  const csrfCookie = cookies.get(USER_CSRF_COOKIE)?.value;

  if (sessionToken) {
    const validCsrf = await verifyUserCsrfToken(request, csrfCookie, sessionToken);
    if (!validCsrf) {
      return jsonResponse({ error: 'CSRF validation failed.' }, 403);
    }
    const db = await getDb(locals);
    if (db) {
      await revokeUserSession(db, sessionToken);
    }
  }

  clearUserAuthCookies(cookies);
  return jsonResponse({ ok: true });
};

