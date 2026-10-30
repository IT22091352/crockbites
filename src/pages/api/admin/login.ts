import type { APIRoute } from 'astro';

export const prerender = false;
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  buildSessionCookie,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
  getClientIp,
  createCsrfToken,
  getAdminSessionSecret,
  getRuntimeSecret,
  parseAdminSessionCookie,
  verifyPassword,
} from '../../../lib/admin';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const ip = getClientIp(request);
  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const csrfToken = String(form.get('csrfToken') ?? request.headers.get('x-csrf-token') ?? '').trim();

  // Rate limiting check prior to any cryptographic work
  const rateLimit = await checkLoginRateLimit(ip, username);
  if (!rateLimit.allowed) {
    const retryMinutes = Math.ceil(rateLimit.retryAfterSeconds / 60);
    return new Response(
      JSON.stringify({
        error: `Too many failed login attempts. Please wait ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'} before trying again.`,
        retryAfter: rateLimit.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

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
    await recordFailedLogin(ip, username);
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
    const failureResult = await recordFailedLogin(ip, username);
    cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
    cookies.set(CSRF_COOKIE_NAME, expectedLoginToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 60 * 60 * 12,
    });

    if (failureResult.locked) {
      const retryMinutes = Math.ceil(failureResult.retryAfterSeconds / 60);
      return new Response(
        JSON.stringify({
          error: `Too many failed login attempts. Please wait ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'} before trying again.`,
          retryAfter: failureResult.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'Retry-After': String(failureResult.retryAfterSeconds),
          },
        }
      );
    }

    return new Response(null, {
      status: 303,
      headers: { location: '/admin/login/?error=Invalid+credentials' },
    });
  }

  // Clear rate-limiting on successful authentication
  await resetLoginRateLimit(ip, username);

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
