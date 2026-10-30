import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../lib/community-server';
import { changeUserPassword, checkUserRateLimit, setUserAuthCookies } from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals, url }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const rl = await checkUserRateLimit('change_password', auth.user.id, 5, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse({ error: 'Too many password change attempts. Please wait and try again.' }, 429);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (body.newPassword !== body.confirmPassword) {
    return jsonResponse({ error: 'New passwords do not match.' }, 400);
  }

  const res = await changeUserPassword(auth.db, auth.user.id, body.currentPassword, body.newPassword);
  if (!res.ok) {
    return jsonResponse({ error: res.error }, 400);
  }

  const csrfToken = setUserAuthCookies(cookies, res.sessionToken, res.maxAgeSeconds, url.protocol === 'https:');
  return jsonResponse({
    ok: true,
    csrfToken,
    message: 'Password updated and all other sessions have been signed out.',
  });
};

