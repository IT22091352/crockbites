import type { APIRoute } from 'astro';
import {
  addRecipeToCollection,
  deleteCollection,
  getCollectionDetails,
  removeRecipeFromCollection,
  updateCollection,
} from '../../../../lib/community';
import {
  getPublishedRecipesMap,
  jsonResponse,
  requireAuthenticatedUserApi,
  resolveUserSession,
} from '../../../../lib/community-server';

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies, locals, url }) => {
  const { db, user } = await resolveUserSession(cookies, locals, url.protocol);
  if (!db) {
    return jsonResponse({ error: 'Community database is not configured.' }, 503);
  }

  const collectionId = String(params.id ?? '').trim();
  const detail = await getCollectionDetails(db, collectionId, user?.id ?? null);
  if (!detail) {
    return jsonResponse({ error: 'Collection not found or private.' }, 404);
  }

  return jsonResponse({ ok: true, collection: detail });
};

export const PUT: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const collectionId = String(params.id ?? '').trim();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const res = await updateCollection(auth.db, auth.user.id, collectionId, {
    name: body.name,
    description: body.description,
    isPublic: body.isPublic,
  });

  if (!res.ok) return jsonResponse({ error: res.error }, 400);
  return jsonResponse({ ok: true, collection: res.collection });
};

export const POST: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const collectionId = String(params.id ?? '').trim();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const action = String(body.action ?? 'add');
  if (action === 'remove') {
    const res = await removeRecipeFromCollection(auth.db, auth.user.id, collectionId, body.recipeSlug);
    if (!res.ok) return jsonResponse({ error: res.error }, 400);
    return jsonResponse({ ok: true, inCollection: false });
  }

  const { slugSet } = await getPublishedRecipesMap();
  const res = await addRecipeToCollection(auth.db, auth.user.id, collectionId, body.recipeSlug, slugSet);
  if (!res.ok) return jsonResponse({ error: res.error }, 400);
  return jsonResponse({ ok: true, inCollection: true });
};

export const DELETE: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const collectionId = String(params.id ?? '').trim();
  const res = await deleteCollection(auth.db, auth.user.id, collectionId);
  if (!res.ok) return jsonResponse({ error: res.error }, 404);
  return jsonResponse({ ok: true });
};

