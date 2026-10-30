import type { APIRoute } from 'astro';
import { deleteOwnReview, updateOwnReviewById } from '../../../../lib/community';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../../lib/community-server';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const reviewId = String(params.id ?? '').trim();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const res = await updateOwnReviewById(auth.db, auth.user, reviewId, {
    rating: body.rating,
    title: body.title,
    comment: body.comment,
  });

  if (!res.ok) return jsonResponse({ error: res.error }, 400);
  return jsonResponse({
    ok: true,
    review: res.review,
    message: 'Your review has been updated and queued for moderation.',
  });
};

export const DELETE: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const reviewId = String(params.id ?? '').trim();
  const res = await deleteOwnReview(auth.db, auth.user.id, reviewId);
  if (!res.ok) return jsonResponse({ error: res.error }, 404);
  return jsonResponse({ ok: true });
};

