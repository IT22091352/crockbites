import type { APIRoute } from 'astro';
import { getPublicRecipeReviews, submitReview } from '../../../../lib/community';
import {
  getPublishedRecipesMap,
  jsonResponse,
  requireAuthenticatedUserApi,
  resolveUserSession,
} from '../../../../lib/community-server';
import { checkUserRateLimit } from '../../../../lib/user-auth';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, locals, url }) => {
  const recipeSlug = (url.searchParams.get('recipeSlug') ?? '').trim().toLowerCase();
  if (!recipeSlug) {
    return jsonResponse({ error: 'recipeSlug parameter is required.' }, 400);
  }

  const { db, user } = await resolveUserSession(cookies, locals, url.protocol);
  if (!db) {
    return jsonResponse({
      ok: true,
      recipeSlug,
      averageRating: 0,
      totalApproved: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      reviews: [],
      page: 1,
      pageSize: 10,
      totalPages: 1,
      myReview: null,
    });
  }

  const page = Number(url.searchParams.get('page') ?? 1);
  const stats = await getPublicRecipeReviews(db, recipeSlug, page, 10, user?.id ?? null);
  return jsonResponse({ ok: true, ...stats });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const rl = await checkUserRateLimit('review_submit', auth.user.id, 5, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'You are submitting reviews too quickly. Please wait a few minutes.' },
      429,
      { 'retry-after': String(rl.retryAfterSeconds) },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const { slugSet } = await getPublishedRecipesMap();
  const res = await submitReview(
    auth.db,
    auth.user,
    {
      recipeSlug: body.recipeSlug,
      rating: body.rating,
      title: body.title,
      comment: body.comment,
    },
    slugSet,
  );

  if (!res.ok) {
    return jsonResponse({ error: res.error }, res.duplicate ? 409 : 400);
  }

  return jsonResponse(
    {
      ok: true,
      review: res.review,
      isUpdate: false,
      message: 'Thank you! Your review has been published.',
    },
    201,
  );
};

