import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../lib/community-server';
import { clearUserAuthCookies, deleteUserAccount } from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const res = await deleteUserAccount(auth.db, auth.user.id, body.password);
  if (!res.ok) {
    return jsonResponse({ error: res.error }, 400);
  }

  clearUserAuthCookies(cookies);
  return jsonResponse({
    ok: true,
    message: 'Your account and personal data have been permanently deleted.',
  });
};

