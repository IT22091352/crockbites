import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../lib/community-server';
import { updateUserProfile } from '../../../lib/user-auth';

export const prerender = false;

export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const res = await updateUserProfile(auth.db, auth.user.id, {
    displayName: body.displayName,
    username: body.username,
    bio: body.bio,
    avatarUrl: body.avatarUrl,
  });

  if (!res.ok) {
    return jsonResponse({ error: res.error }, 400);
  }

  return jsonResponse({ ok: true, user: res.user });
};

