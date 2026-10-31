import type { APIRoute } from 'astro';
import { getClientIp } from '../../../lib/admin';
import { getDb } from '../../../lib/db';
import { jsonResponse, logServerDiagnostic } from '../../../lib/community-server';
import { sendVerificationEmail } from '../../../lib/email';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  checkUserRateLimit,
  createEmailVerificationToken,
  isTransactionalEmailConfigured,
  registerUser,
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

    const ip = getClientIp(request);
    const rl = await checkUserRateLimit('register', ip, 6, 15 * 60);
    if (!rl.allowed) {
      return jsonResponse(
        { error: 'Too many registration attempts. Please try again later.', retryAfterSeconds: rl.retryAfterSeconds },
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

    const result = await registerUser(db, {
      username: body.username,
      email: body.email,
      displayName: body.displayName,
      password: body.password,
      confirmPassword: body.confirmPassword,
      termsAccepted: body.termsAccepted,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.error }, 400);
    }

    // If transactional email is configured, dispatch initial email verification link
    if (isTransactionalEmailConfigured().configured) {
      try {
        const tokenRes = await createEmailVerificationToken(db, result.user.id);
        let origin = 'https://crockbites.site';
        try {
          const parsed = new URL(request.url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            origin = parsed.origin;
          }
        } catch {}
        const verifyUrl = `${origin}/verify-email/?token=${encodeURIComponent(tokenRes.rawToken)}`;
        const emailRes = await sendVerificationEmail({
          to: result.user.email,
          displayName: result.user.displayName,
          verifyUrl,
        });
        if (!emailRes.ok) {
          try {
            await db
              .prepare(`DELETE FROM email_verification_tokens WHERE id = ?`)
              .bind(tokenRes.id)
              .run();
          } catch (cleanupErr) {
            logServerDiagnostic('register:cleanup_token', cleanupErr);
          }
        }
      } catch (e) {
        logServerDiagnostic('register:sendVerificationEmail', e);
      }
    }

    const isHttps = url.protocol === 'https:';
    const csrfToken = setUserAuthCookies(cookies, result.sessionToken, result.maxAgeSeconds, isHttps);

    return jsonResponse(
      {
        ok: true,
        user: result.user,
        csrfToken,
        redirectTo: sanitizeReturnUrl(body.returnTo, '/account/'),
      },
      201,
    );
  } catch (err) {
    logServerDiagnostic('POST /api/auth/register', err);
    return jsonResponse({ error: 'An unexpected server error occurred during registration.' }, 500);
  }
};

