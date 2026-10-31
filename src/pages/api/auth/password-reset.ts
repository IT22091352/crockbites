import type { APIRoute } from 'astro';
import { getClientIp } from '../../../lib/admin';
import { getDb } from '../../../lib/db';
import { jsonResponse } from '../../../lib/community-server';
import { logEmailDiagnostic, sendPasswordResetEmail } from '../../../lib/email';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  checkUserRateLimit,
  confirmPasswordResetToken,
  createPasswordResetRequest,
  isTransactionalEmailConfigured,
  verifyUserCsrfToken,
} from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = await getDb(locals);
  if (!db) {
    return jsonResponse({ error: 'Database binding "DB" is not configured.' }, 503);
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
  const rl = await checkUserRateLimit('password_reset', ip, 5, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Too many password reset requests. Please try again later.' },
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

  const action = String(body.action ?? 'request');

  if (action === 'confirm') {
    const res = await confirmPasswordResetToken(db, body.token, body.newPassword);
    if (!res.ok) return jsonResponse({ error: res.error }, 400);
    return jsonResponse({
      ok: true,
      message: 'Your password has been reset and all previous sessions have been revoked. You may now sign in.',
    });
  }

  const emailProvider = isTransactionalEmailConfigured();
  if (!emailProvider.configured) {
    return jsonResponse(
      {
        ok: false,
        emailDeliveryConfigured: false,
        error: 'Password reset by email is currently unavailable while custom domain email delivery is deferred.',
      },
      503,
    );
  }

  const res = await createPasswordResetRequest(db, body.email);

  // If a valid active user was found and a token generated, dispatch reset email
  if (res._internalRawToken && res._internalUser) {
    let origin = 'https://crockbites.site';
    try {
      const parsed = new URL(request.url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origin = parsed.origin;
      }
    } catch {}

    const resetUrl = `${origin}/reset-password/?token=${encodeURIComponent(res._internalRawToken)}`;
    const emailRes = await sendPasswordResetEmail({
      to: res._internalUser.email,
      displayName: res._internalUser.displayName,
      resetUrl,
    });

    // If delivery failed, delete only the exact newly created token to avoid leaving an orphaned reset token
    if (!emailRes.ok && res._internalTokenId) {
      try {
        await db
          .prepare(`DELETE FROM password_reset_tokens WHERE id = ?`)
          .bind(res._internalTokenId)
          .run();
      } catch (cleanupErr) {
        logEmailDiagnostic('password_reset:cleanup_token', cleanupErr);
      }
    }
  }

  // Always return identical generic message to prevent email enumeration
  return jsonResponse({
    ok: true,
    emailDeliveryConfigured: res.emailDeliveryConfigured,
    message: res.message,
  });
};
