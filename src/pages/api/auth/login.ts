import type { APIRoute } from 'astro';
import { getClientIp } from '../../../lib/admin';
import { getDb } from '../../../lib/db';
import { jsonResponse, logServerDiagnostic } from '../../../lib/community-server';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  authenticateUser,
  checkUserRateLimit,
  sanitizeReturnUrl,
  setUserAuthCookies,
  verifyUserCsrfToken,
} from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals, url }) => {
  try {
    const db = await getDb(locals);
    if (!db) {
      return jsonResponse(
        { error: 'Community database (Cloudflare D1 binding "DB") is not configured.' },
        503,
      );
    }

    const csrfCookie = cookies.get(USER_CSRF_COOKIE)?.value;
    const existingSession = cookies.get(USER_SESSION_COOKIE)?.value;
    const csrfOk =
      (await verifyUserCsrfToken(request, csrfCookie, 'guest')) ||
      (Boolean(existingSession) && (await verifyUserCsrfToken(request, csrfCookie, existingSession)));
    if (!csrfOk) {
      return jsonResponse({ error: 'Security check (CSRF) failed. Please refresh and try again.' }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
    const ip = getClientIp(request);

    // Rate limit by IP and by account identifier
    const [ipLimit, idLimit] = await Promise.all([
      checkUserRateLimit('login_ip', ip, 10, 15 * 60),
      identifier ? checkUserRateLimit('login_id', identifier, 6, 15 * 60) : Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    ]);

    if (!ipLimit.allowed || !idLimit.allowed) {
      const retry = Math.max(ipLimit.retryAfterSeconds, idLimit.retryAfterSeconds);
      return jsonResponse(
        { error: 'Too many sign-in attempts. Please wait before trying again.', retryAfterSeconds: retry },
        429,
        { 'retry-after': String(retry) },
      );
    }

    const result = await authenticateUser(db, body.identifier, body.password, Boolean(body.rememberMe));
    if (!result.ok) {
      return jsonResponse({ error: result.error }, 401);
    }

    const isHttps = url.protocol === 'https:';
    const csrfToken = setUserAuthCookies(cookies, result.sessionToken, result.maxAgeSeconds, isHttps);

    return jsonResponse({
      ok: true,
      user: result.user,
      csrfToken,
      redirectTo: sanitizeReturnUrl(body.returnTo, '/account/'),
    });
  } catch (err) {
    logServerDiagnostic('POST /api/auth/login', err);
    return jsonResponse({ error: 'An unexpected server error occurred during sign-in.' }, 500);
  }
};

