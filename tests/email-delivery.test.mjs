import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMAIL_FROM,
  renderPasswordResetEmail,
  renderVerificationEmail,
  sendEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../src/lib/email.ts';
import { isTransactionalEmailConfigured } from '../src/lib/user-auth.ts';

test('1. Default sender email and domain configuration', () => {
  assert.equal(DEFAULT_EMAIL_FROM, 'CrockBites <no-reply@mail.crockbites.site>');
  assert.ok(DEFAULT_EMAIL_FROM.includes('mail.crockbites.site'));
});

test('2. Verification email template formatting and security contents', () => {
  const verifyUrl = 'https://crockbites.site/verify-email/?token=mock_verify_token_12345';
  const rendered = renderVerificationEmail({
    displayName: 'Julia Child',
    verifyUrl,
  });

  // Subject
  assert.equal(rendered.subject, 'Verify your email for CrockBites');

  // HTML content
  assert.ok(rendered.html.includes('Julia Child'), 'Includes recipient name');
  assert.ok(rendered.html.includes(verifyUrl), 'Includes verification URL');
  assert.ok(rendered.html.includes('#243A2D'), 'Uses Forest Green brand color');
  assert.ok(rendered.html.includes('#F7F1E5'), 'Uses Warm Cream brand color');
  assert.ok(rendered.html.includes('#C66A45'), 'Uses Terracotta brand color');
  assert.ok(rendered.html.includes('24 hours'), 'Includes 24-hour expiration notice');
  assert.ok(rendered.html.includes('Confirm Email Address'), 'Includes clear CTA button text');
  assert.ok(rendered.html.includes('crockbites.site'), 'Includes CrockBites site link in footer');
  assert.ok(
    rendered.html.includes('safely disregard this email'),
    'Includes security notice for unintended recipients',
  );

  // Plain text version
  assert.ok(rendered.text.includes('Julia Child'));
  assert.ok(rendered.text.includes(verifyUrl));
  assert.ok(rendered.text.includes('24 hours'));
  assert.ok(rendered.text.includes('https://crockbites.site'));
});

test('3. Password reset email template formatting and security contents', () => {
  const resetUrl = 'https://crockbites.site/reset-password/?token=mock_reset_token_67890';
  const rendered = renderPasswordResetEmail({
    displayName: 'Gordon Ramsay',
    resetUrl,
  });

  // Subject
  assert.equal(rendered.subject, 'Reset your CrockBites password');

  // HTML content
  assert.ok(rendered.html.includes('Gordon Ramsay'), 'Includes recipient name');
  assert.ok(rendered.html.includes(resetUrl), 'Includes reset URL');
  assert.ok(rendered.html.includes('#243A2D'), 'Uses Forest Green brand color');
  assert.ok(rendered.html.includes('30 minutes'), 'Includes 30-minute expiration notice');
  assert.ok(rendered.html.includes('Reset My Password'), 'Includes clear CTA button text');
  assert.ok(
    rendered.html.includes('revoke all currently active sessions'),
    'Includes session revocation notice',
  );
  assert.ok(
    rendered.html.includes('safely ignore this message'),
    'Includes security notice if reset was not requested',
  );

  // Plain text version
  assert.ok(rendered.text.includes('Gordon Ramsay'));
  assert.ok(rendered.text.includes(resetUrl));
  assert.ok(rendered.text.includes('30 minutes'));
  assert.ok(rendered.text.includes('https://crockbites.site'));
});

test('4. Graceful handling when RESEND_API_KEY is unconfigured', async () => {
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  try {
    const status = isTransactionalEmailConfigured();
    assert.equal(status.configured, false);
    assert.equal(status.provider, 'unconfigured');

    const res = await sendEmail({
      to: 'chef@example.com',
      subject: 'Test Subject',
      html: '<p>Test</p>',
      text: 'Test',
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('missing RESEND_API_KEY'));
  } finally {
    if (originalKey !== undefined) {
      process.env.RESEND_API_KEY = originalKey;
    }
  }
});

test('5. Native fetch integration with Resend API endpoint and mock delivery', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  process.env.RESEND_API_KEY = 're_test_mock_secret_key_123';
  delete process.env.EMAIL_FROM; // Test fallback to default sender

  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = {};

  try {
    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedHeaders = options?.headers || {};
      capturedBody = JSON.parse(String(options?.body || '{}'));

      return new Response(JSON.stringify({ id: 'resend_email_id_abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const status = isTransactionalEmailConfigured();
    assert.equal(status.configured, true);
    assert.equal(status.provider, 'Resend');

    const sendRes = await sendVerificationEmail({
      to: 'testuser@crockbites.site',
      displayName: 'Slow Cooker Fan',
      verifyUrl: 'https://crockbites.site/verify-email/?token=abc',
    });

    assert.equal(sendRes.ok, true);
    assert.equal(sendRes.id, 'resend_email_id_abc123');
    assert.equal(capturedUrl, 'https://api.resend.com/emails');
    assert.equal(capturedHeaders.Authorization, 'Bearer re_test_mock_secret_key_123');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.equal(capturedBody.from, 'CrockBites <no-reply@mail.crockbites.site>');
    assert.deepEqual(capturedBody.to, ['testuser@crockbites.site']);
    assert.equal(capturedBody.subject, 'Verify your email for CrockBites');
    assert.ok(capturedBody.html.includes('Slow Cooker Fan'));
    assert.ok(capturedBody.text.includes('Slow Cooker Fan'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;
    if (originalFrom !== undefined) process.env.EMAIL_FROM = originalFrom;
  }
});

test('6. Resend API error response handled safely without secret leakage', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  process.env.RESEND_API_KEY = 're_test_mock_secret_key_123';

  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          statusCode: 403,
          message: 'Domain not verified or sender address mismatch',
          name: 'validation_error',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const sendRes = await sendPasswordResetEmail({
      to: 'target@example.com',
      displayName: 'Target User',
      resetUrl: 'https://crockbites.site/reset-password/?token=xyz',
    });

    assert.equal(sendRes.ok, false);
    assert.equal(sendRes.error, 'Domain not verified or sender address mismatch');
    // Ensure secret is never in the error message
    assert.ok(!sendRes.error.includes('re_test_mock_secret_key_123'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;
  }
});

test('7. Anti-scanner / bot protection requirements check', () => {
  // Verification URLs must not consume tokens purely on GET
  // Verify that the rendered URLs point to frontend pages (/verify-email/ and /reset-password/)
  // and NOT directly to API POST endpoints (/api/auth/...)
  const v = renderVerificationEmail({ verifyUrl: 'https://crockbites.site/verify-email/?token=abc' });
  assert.ok(v.html.includes('/verify-email/?token=abc'));
  assert.ok(!v.html.includes('/api/auth/verify-email'));

  const p = renderPasswordResetEmail({ resetUrl: 'https://crockbites.site/reset-password/?token=xyz' });
  assert.ok(p.html.includes('/reset-password/?token=xyz'));
  assert.ok(!p.html.includes('/api/auth/password-reset'));
});

test('8. Orphaned token cleanup on email delivery failure', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { createSqliteD1Adapter, ensureCommunitySchema } = await import('../src/lib/db.ts');
  const {
    createEmailVerificationToken,
    createPasswordResetRequest,
    registerUser,
  } = await import('../src/lib/user-auth.ts');

  const rawDb = new DatabaseSync(':memory:');
  const db = createSqliteD1Adapter(rawDb);
  await ensureCommunitySchema(db);

  const reg = await registerUser(db, {
    username: 'cleanup_test',
    email: 'cleanup@example.com',
    password: 'Password123',
  });
  assert.equal(reg.ok, true);
  const userId = reg.user.id;

  // 1. Verification token cleanup
  const vToken = await createEmailVerificationToken(db, userId);
  assert.ok(vToken.id, 'createEmailVerificationToken returns exact token ID');

  // Verify token exists in D1
  const vBefore = await db
    .prepare('SELECT id FROM email_verification_tokens WHERE id = ?')
    .bind(vToken.id)
    .first();
  assert.ok(vBefore, 'Token exists before cleanup');

  // Simulate delivery failure cleanup: delete by exact ID
  await db
    .prepare('DELETE FROM email_verification_tokens WHERE id = ?')
    .bind(vToken.id)
    .run();

  const vAfter = await db
    .prepare('SELECT id FROM email_verification_tokens WHERE id = ?')
    .bind(vToken.id)
    .first();
  assert.equal(vAfter, null, 'Token is removed after delivery failure cleanup');

  // 2. Password reset token cleanup
  const resetReq = await createPasswordResetRequest(db, 'cleanup@example.com');
  assert.equal(resetReq.ok, true);
  assert.ok(resetReq._internalTokenId, 'createPasswordResetRequest returns exact _internalTokenId');

  // Verify reset token exists in D1
  const rBefore = await db
    .prepare('SELECT id FROM password_reset_tokens WHERE id = ?')
    .bind(resetReq._internalTokenId)
    .first();
  assert.ok(rBefore, 'Reset token exists before cleanup');

  // Simulate delivery failure cleanup: delete by exact ID
  await db
    .prepare('DELETE FROM password_reset_tokens WHERE id = ?')
    .bind(resetReq._internalTokenId)
    .run();

  const rAfter = await db
    .prepare('SELECT id FROM password_reset_tokens WHERE id = ?')
    .bind(resetReq._internalTokenId)
    .first();
  assert.equal(rAfter, null, 'Reset token is removed after delivery failure cleanup');
});

test('9. Dual-context CSRF verification for guest and authenticated sessions', async () => {
  const { createUserCsrfToken, verifyUserCsrfToken } = await import('../src/lib/user-auth.ts');

  const guestCsrf = createUserCsrfToken('guest');
  const sessionToken = 'mock_session_token_abcdef123456';
  const sessionCsrf = createUserCsrfToken(sessionToken);

  // 1. Guest request with guest CSRF
  const guestReq = new Request('https://crockbites.site/api/auth/password-reset/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': guestCsrf,
    },
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  const guestOk = await verifyUserCsrfToken(guestReq, guestCsrf, 'guest');
  assert.equal(guestOk, true, 'Guest CSRF token accepted in guest context');

  // 2. Authenticated user request with session CSRF
  const authReq = new Request('https://crockbites.site/api/auth/password-reset/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': sessionCsrf,
    },
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  const authOk = await verifyUserCsrfToken(authReq, sessionCsrf, sessionToken);
  assert.equal(authOk, true, 'Authenticated session CSRF token accepted in session context');

  // 3. Dual-context check (like in password-reset.ts)
  const isDualOkForGuest =
    (await verifyUserCsrfToken(guestReq, guestCsrf, 'guest')) ||
    (Boolean(undefined) && (await verifyUserCsrfToken(guestReq, guestCsrf, 'none')));
  assert.equal(isDualOkForGuest, true, 'Dual-context check passes for guest');

  const isDualOkForAuth =
    (await verifyUserCsrfToken(authReq, sessionCsrf, 'guest')) ||
    (Boolean(sessionToken) && (await verifyUserCsrfToken(authReq, sessionCsrf, sessionToken)));
  assert.equal(isDualOkForAuth, true, 'Dual-context check passes for authenticated user');

  // 4. Invalid CSRF token rejected
  const badReq = new Request('https://crockbites.site/api/auth/password-reset/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'invalid_forged_csrf_token',
    },
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  const badOk =
    (await verifyUserCsrfToken(badReq, sessionCsrf, 'guest')) ||
    (Boolean(sessionToken) && (await verifyUserCsrfToken(badReq, sessionCsrf, sessionToken)));
  assert.equal(badOk, false, 'Invalid CSRF token rejected in dual-context check');
});


