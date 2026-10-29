import type { APIRoute } from 'astro';

export const prerender = false;
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  buildSessionCookie,
  checkRateLimit,
  createCsrfToken,
  getAdminSessionSecret,
  getRuntimeSecret,
  parseAdminSessionCookie,
  verifyPassword,
} from '../../../lib/admin';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`login:${ip}`)) {
    return new Response(JSON.stringify({ error: 'Too many failed login attempts. Please wait a few minutes.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const csrfToken = String(form.get('csrfToken') ?? request.headers.get('x-csrf-token') ?? '').trim();
  const validUsername = getRuntimeSecret('ADMIN_USERNAME');
  const storedHash = getRuntimeSecret('ADMIN_PASSWORD_HASH');
  const secret = getAdminSessionSecret();

  if (!validUsername || !storedHash || !secret) {
    return new Response(JSON.stringify({ error: 'Admin authentication is not configured.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const isHttps = url.protocol === 'https:' || request.url.startsWith('https:');
  const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
  const expectedLoginToken = createCsrfToken(secret, 'login');
  const session = parseAdminSessionCookie(cookies.get(ADMIN_COOKIE_NAME)?.value);
  const expectedSessionToken = session ? createCsrfToken(secret, session.id) : null;
  const validTokens = new Set([expectedLoginToken, ...(expectedSessionToken ? [expectedSessionToken] : [])]);

  if (!csrfCookie || !csrfToken || csrfCookie !== csrfToken || !validTokens.has(csrfToken)) {
    // Re-issue fresh login CSRF token so next attempt succeeds
    cookies.set(CSRF_COOKIE_NAME, expectedLoginToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return new Response(null, {
      status: 303,
      headers: { location: '/admin/login/?error=Security+check+failed' },
    });
  }

  if (username !== validUsername || !verifyPassword(password, storedHash)) {
    cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
    // Re-issue CSRF token on bad password so next submit doesn't trigger "Security check failed"
    cookies.set(CSRF_COOKIE_NAME, expectedLoginToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return new Response(null, {
      status: 303,
      headers: { location: '/admin/login/?error=Invalid+credentials' },
    });
  }

  const authCookie = buildSessionCookie(username, secret);
  const parsed = parseAdminSessionCookie(authCookie);
  const csrfValue = parsed ? createCsrfToken(secret, parsed.id) : expectedLoginToken;

  cookies.set(ADMIN_COOKIE_NAME, authCookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  cookies.set(CSRF_COOKIE_NAME, csrfValue, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  return new Response(null, { status: 303, headers: { location: '/admin/' } });
};
