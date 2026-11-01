import type { APIRoute } from 'astro';

export const prerender = false;
import YAML from 'yaml';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ensureCsrfToken,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
  verifyAdminSession,
} from '../../../../lib/admin.ts';
import { getDb } from '../../../../lib/db.ts';
import { setRecipeStatusInDb, invalidateRecipeMemoryCache } from '../../../../lib/recipes-db.ts';

const isAuthorized = async (request: Request, cookies: any) => {
  // Safe HTTP methods (RFC 9110) do not mutate state and do not require CSRF token
  const requireCsrf = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
  return verifyAdminSession(request, cookies, { requireCsrf });
};

export function updateRecipeStatusInMarkdown(content: string, newStatus: 'draft' | 'tested'): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  if (!match) {
    throw new Error('File does not contain valid YAML frontmatter');
  }

  const rawYaml = match[1];
  const rest = match[2] ?? '';
  const parsed = YAML.parse(rawYaml);
  parsed.reviewStatus = newStatus;
  parsed.updatedDate = new Date().toISOString().slice(0, 10);

  return `---\n${YAML.stringify(parsed, { lineWidth: 0 })}---${rest}\n`;
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request body.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const slugs = Array.isArray(body?.slugs) ? body.slugs.map((s: unknown) => String(s ?? '').trim()).filter(Boolean) : [];
  const status = String(body?.status ?? '').trim();

  if (slugs.length === 0) {
    return new Response(JSON.stringify({ error: 'At least one recipe slug is required.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (status !== 'draft' && status !== 'tested') {
    return new Response(JSON.stringify({ error: 'Status must be either "draft" or "tested".' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = await getDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database is not available.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const updated: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  for (const slug of slugs) {
    try {
      const ok = await setRecipeStatusInDb(db, slug, status as 'draft' | 'tested');
      if (ok) {
        updated.push(slug);
      } else {
        failed.push({ slug, error: `Recipe "${slug}" not found in D1.` });
      }
    } catch (err) {
      failed.push({
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  invalidateRecipeMemoryCache();

  return new Response(
    JSON.stringify({
      success: failed.length === 0,
      updated,
      failed,
      total: slugs.length,
      status,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};
