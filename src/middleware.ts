import { defineMiddleware } from 'astro:middleware';
import { loadRuntimeEnv } from './lib/runtime-env';
import { ensureCsrfToken, createCsrfToken, ADMIN_COOKIE_NAME, CSRF_COOKIE_NAME, checkRateLimit, getAdminSessionSecret, parseAdminSessionCookie, verifySessionCookie } from './lib/admin';

/** Authenticated admin API calls (recipe saves, image uploads). Login attempts keep their own, stricter limit. */
const ADMIN_API_MAX_REQUESTS = 240;

export const onRequest = defineMiddleware(async (context, next) => {
  await loadRuntimeEnv();
  const url = new URL(context.request.url);
  const path = url.pathname;
  const normalizedPath = path.replace(/\/+$/, '') || '/';
  const isLoginRoute = normalizedPath === '/admin/login';
  const isLoginApiRoute = normalizedPath === '/api/admin/login';
  const isApiRoute = normalizedPath.startsWith('/api/admin');
  const secret = getAdminSessionSecret();

  if ((path.startsWith('/admin') || path.startsWith('/api/admin')) && !path.endsWith('/')) {
    if (path !== '/admin' && path !== '/api/admin') {
      const redirectUrl = `${path}/` + (url.search || '');
      return context.redirect(redirectUrl);
    }
    if (path === '/admin') {
      return context.redirect('/admin/');
    }
    if (path === '/api/admin') {
      return context.redirect('/api/admin/');
    }
  }

  if (normalizedPath.startsWith('/admin') && !isLoginRoute) {
    const cookieValue = context.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!cookieValue) {
      return context.redirect('/admin/login/');
    }

    if (!secret || !verifySessionCookie(cookieValue, secret)) {
      context.cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
      context.cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
      return context.redirect('/admin/login/?error=Session+expired');
    }
  }

  if (isApiRoute) {
    const ip = context.request.headers.get('cf-connecting-ip') ?? context.request.headers.get('x-forwarded-for') ?? 'unknown';
    if (!checkRateLimit(`api-admin:${ip}`, ADMIN_API_MAX_REQUESTS)) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    const method = context.request.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrfCookie = context.cookies.get(CSRF_COOKIE_NAME)?.value ?? '';

      if (isLoginApiRoute) {
        if (!secret || !(await ensureCsrfToken(context.request, csrfCookie, secret, 'login'))) {
          const accept = context.request.headers.get('accept') ?? '';
          if (accept.includes('text/html') || !accept.includes('application/json')) {
            const isHttps = url.protocol === 'https:' || context.request.url.startsWith('https:');
            if (secret) {
              context.cookies.set(CSRF_COOKIE_NAME, createCsrfToken(secret, 'login'), {
                httpOnly: false,
                sameSite: 'lax',
                secure: isHttps,
                path: '/',
                maxAge: 60 * 60 * 12,
              });
            }
            return context.redirect('/admin/login/?error=Security+check+failed');
          }
          return new Response(JSON.stringify({ error: 'CSRF validation failed.' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }
        return next();
      }

      const sessionCookie = context.cookies.get(ADMIN_COOKIE_NAME)?.value;
      if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }

      const session = parseAdminSessionCookie(sessionCookie);
      if (!session) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (!(await ensureCsrfToken(context.request, csrfCookie, secret, session.id))) {
        return new Response(JSON.stringify({ error: 'CSRF validation failed.' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
  }

  const response = await next();
  if (
    normalizedPath.startsWith('/account') ||
    normalizedPath.startsWith('/login') ||
    normalizedPath.startsWith('/register') ||
    normalizedPath.startsWith('/logout') ||
    normalizedPath.startsWith('/api/auth') ||
    normalizedPath.startsWith('/api/account') ||
    normalizedPath.startsWith('/api/community')
  ) {
    response.headers.set('cache-control', 'private, no-store, no-cache, must-revalidate');
  }
  return response;
});
