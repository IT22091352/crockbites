import type { APIRoute } from 'astro';
import { deleteOwnReview, updateOwnReviewById } from '../../../../lib/community';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../../lib/community-server';
import { checkUserRateLimit } from '../../../../lib/user-auth';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const rl = await checkUserRateLimit('review_update', auth.user.id, 10, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'You are updating reviews too quickly. Please wait a few minutes.' },
      429,
      { 'retry-after': String(rl.retryAfterSeconds) },
    );
  }

  const reviewId = String(params.id ?? '').trim();
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  // Always obtain user identity from the authenticated server session (never from request body)
  const res = await updateOwnReviewById(auth.db, auth.user, reviewId, {
    rating: body.rating,
    title: body.title,
    comment: body.comment,
  });

  if (!res.ok) {
    return jsonResponse({ error: res.error }, res.statusCode ?? 400);
  }

  return jsonResponse({
    ok: true,
    review: res.review,
    message: 'Your review has been updated and published.',
  });
};

export const PATCH: APIRoute = PUT;

export const DELETE: APIRoute = async ({ params, request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const rl = await checkUserRateLimit('review_delete', auth.user.id, 10, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'You are performing actions too quickly. Please wait a few minutes.' },
      429,
      { 'retry-after': String(rl.retryAfterSeconds) },
    );
  }

  const reviewId = String(params.id ?? '').trim();
  const res = await deleteOwnReview(auth.db, auth.user.id, reviewId);
  if (!res.ok) {
    return jsonResponse({ error: res.error }, res.statusCode ?? 404);
  }

  return jsonResponse({
    ok: true,
    message: 'Your review has been deleted.',
  });
};

