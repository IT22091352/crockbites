import type { APIRoute } from 'astro';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ensureCsrfToken,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
} from '../../../lib/admin';
import { adminDeleteReview, listAdminReviews } from '../../../lib/community';
import { jsonResponse } from '../../../lib/community-server';
import { getDb } from '../../../lib/db';

export const prerender = false;

async function authorizeAdmin(request: Request, cookies: any, requireCsrf = true) {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return null;
  }
  const session = parseAdminSessionCookie(sessionCookie);
  if (!session) return null;

  if (requireCsrf && request.method !== 'GET' && request.method !== 'HEAD') {
    const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
    const ok = await ensureCsrfToken(request, csrfCookie, secret, session.id);
    if (!ok) return null;
  }

  return session;
}

export const GET: APIRoute = async ({ request, cookies, locals, url }) => {
  const adminSession = await authorizeAdmin(request, cookies, false);
  if (!adminSession) {
    return jsonResponse({ error: 'Unauthorized admin request.' }, 401);
  }

  const db = await getDb(locals);
  if (!db) {
    return jsonResponse({ error: 'Community database (Cloudflare D1 binding "DB") is not configured.' }, 503);
  }

  const ratingParam = url.searchParams.get('rating');
  const data = await listAdminReviews(db, {
    recipeSlug: url.searchParams.get('recipeSlug') ?? undefined,
    rating: ratingParam ? Number(ratingParam) : undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
  });

  return jsonResponse({ ok: true, ...data });
};

export const DELETE: APIRoute = async ({ request, cookies, locals }) => {
  const adminSession = await authorizeAdmin(request, cookies, true);
  if (!adminSession) {
    return jsonResponse({ error: 'Unauthorized or CSRF validation failed.' }, 401);
  }

  const db = await getDb(locals);
  if (!db) {
    return jsonResponse({ error: 'Community database (Cloudflare D1 binding "DB") is not configured.' }, 503);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const reviewId = String(body.reviewId ?? '').trim();
  const res = await adminDeleteReview(db, reviewId);
  if (!res.ok) {
    return jsonResponse({ error: res.error }, 404);
  }

  return jsonResponse({ ok: true });
};

export const POST: APIRoute = async (ctx) => {
  const cloned = ctx.request.clone();
  let body: Record<string, unknown> = {};
  try {
    body = await cloned.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (body.action === 'delete') {
    return DELETE(ctx);
  }

  return jsonResponse({ error: 'Unsupported admin review action.' }, 400);
};

