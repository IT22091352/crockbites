import type { APIRoute } from 'astro';
import { getClientIp } from '../../../lib/admin';
import { getDb } from '../../../lib/db';
import { jsonResponse, requireAuthenticatedUserApi } from '../../../lib/community-server';
import {
  checkUserRateLimit,
  confirmEmailVerificationToken,
  createEmailVerificationToken,
  isTransactionalEmailConfigured,
} from '../../../lib/user-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const action = String(body.action ?? 'request');

  if (action === 'confirm') {
    const db = await getDb(locals);
    if (!db) return jsonResponse({ error: 'Database binding "DB" is not configured.' }, 503);

    const ip = getClientIp(request);
    const rl = await checkUserRateLimit('verify_email_confirm', ip, 10, 15 * 60);
    if (!rl.allowed) {
      return jsonResponse({ error: 'Too many attempts. Please wait before trying again.' }, 429);
    }

    const res = await confirmEmailVerificationToken(db, body.token);
    if (!res.ok) return jsonResponse({ error: res.error }, 400);
    return jsonResponse({ ok: true, message: 'Email address successfully verified.' });
  }

  // Request a new verification token for the currently authenticated user
  const auth = await requireAuthenticatedUserApi(request, cookies, locals, true);
  if (!auth.ok) return auth.response;

  const rl = await checkUserRateLimit('verify_email_req', auth.user.id, 3, 15 * 60);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Please wait a few minutes before requesting another verification email.' },
      429,
    );
  }

  const emailProvider = isTransactionalEmailConfigured();
  if (!emailProvider.configured) {
    return jsonResponse(
      {
        ok: false,
        emailDeliveryConfigured: false,
        error: 'Email verification delivery is currently deferred until the custom sender domain is configured.',
      },
      503,
    );
  }

  await createEmailVerificationToken(auth.db, auth.user.id);

  return jsonResponse({
    ok: true,
    emailDeliveryConfigured: true,
    message: 'Verification token prepared.',
  });
};
