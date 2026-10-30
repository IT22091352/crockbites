import type { APIRoute } from 'astro';
import { createCollection, listUserCollections } from '../../../../lib/community';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../../lib/community-server';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, locals, url }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, false);
  if (!auth.ok) return auth.response;

  const recipeSlug = url.searchParams.get('recipeSlug') ?? undefined;
  const collections = await listUserCollections(auth.db, auth.user.id, recipeSlug);
  return jsonResponse({ ok: true, collections });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const res = await createCollection(auth.db, auth.user.id, {
    name: body.name,
    description: body.description,
    isPublic: body.isPublic,
  });

  if (!res.ok) return jsonResponse({ error: res.error }, 400);
  return jsonResponse({ ok: true, collection: res.collection }, 201);
};

