import type { APIRoute } from 'astro';
import { addFavorite, listUserFavorites, removeFavorite, toggleFavorite } from '../../../lib/community';
import {
  getPublishedRecipesMap,
  jsonResponse,
  requireAuthenticatedUserApi,
} from '../../../lib/community-server';

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, false);
  if (!auth.ok) return auth.response;

  const favorites = await listUserFavorites(auth.db, auth.user.id);
  return jsonResponse({
    ok: true,
    favorites,
    favoriteSlugs: favorites.map((f) => f.recipeSlug),
  });
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

  const action = String(body.action ?? 'toggle');
  const { slugSet } = await getPublishedRecipesMap();

  if (action === 'add') {
    const res = await addFavorite(auth.db, auth.user.id, body.recipeSlug, slugSet);
    if (!res.ok) return jsonResponse({ error: res.error }, 400);
    return jsonResponse(res);
  }

  if (action === 'remove') {
    const res = await removeFavorite(auth.db, auth.user.id, body.recipeSlug);
    if (!res.ok) return jsonResponse({ error: res.error }, 400);
    return jsonResponse(res);
  }

  const res = await toggleFavorite(auth.db, auth.user.id, body.recipeSlug, slugSet);
  if (!res.ok) return jsonResponse({ error: res.error }, 400);
  return jsonResponse(res);
};

