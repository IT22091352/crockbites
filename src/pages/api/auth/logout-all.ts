import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../lib/community-server';
import { clearUserAuthCookies, revokeAllUserSessions } from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  await revokeAllUserSessions(auth.db, auth.user.id);
  clearUserAuthCookies(cookies);

  return jsonResponse({ ok: true, message: 'Signed out of all active sessions.' });
};

