import type { APIRoute } from 'astro';

export const prerender = false;
import {
  ADMIN_COOKIE_NAME,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
} from '../../../../lib/admin';
import { getDb } from '../../../../lib/db';
import { getRecipeNewsletterRecord, isBrevoCampaignConfigured } from '../../../../lib/brevo-campaign';

const isAuthorized = async (cookies: any) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return null;
  }
  return parseAdminSessionCookie(sessionCookie);
};

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const session = await isAuthorized(cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') || '').trim();

  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing required slug query parameter.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const config = isBrevoCampaignConfigured();
  const db = await getDb(locals);
  const record = await getRecipeNewsletterRecord(db, slug);

  return new Response(JSON.stringify({
    configured: config.configured,
    sender: config.sender,
    listId: config.listId,
    record,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
