import type { APIRoute } from 'astro';

export const prerender = false;
import { ADMIN_COOKIE_NAME, CSRF_COOKIE_NAME, createCsrfToken, getAdminSessionSecret, parseAdminSessionCookie, verifySessionCookie } from '../../../lib/admin';

export const POST: APIRoute = async ({ request, cookies }) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = parseAdminSessionCookie(sessionCookie);

  if (!secret || !session || !verifySessionCookie(sessionCookie, secret)) {
    cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
    cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
    return new Response(null, { status: 303, headers: { location: '/admin/login/?logged_out=1' } });
  }

  let csrfToken = request.headers.get('x-csrf-token') ?? '';
  if (!csrfToken) {
    try {
      const form = await request.clone().formData();
      csrfToken = String(form.get('csrfToken') ?? '');
    } catch {
      // not form data
    }
  }

  const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
  const expectedToken = createCsrfToken(secret, session.id);
  if (!csrfCookie || !csrfToken || csrfCookie !== csrfToken || csrfCookie !== expectedToken) {
    cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
    cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
    return new Response(JSON.stringify({ error: 'CSRF validation failed.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
  cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
  return new Response(null, { status: 303, headers: { location: '/admin/login/?logged_out=1' } });
};
