import type { APIRoute } from 'astro';
import { getClientIp } from '../../../lib/admin';
import { getDb } from '../../../lib/db';
import { jsonResponse } from '../../../lib/community-server';
import {
  USER_CSRF_COOKIE,
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
  if (!(await verifyUserCsrfToken(request, csrfCookie, 'guest'))) {
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

  // Never expose _internalRawToken in HTTP response
  return jsonResponse({
    ok: true,
    emailDeliveryConfigured: res.emailDeliveryConfigured,
    message: res.message,
  });
};
