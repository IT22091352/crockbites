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
} from '../../../../lib/admin.ts';
import { getRepoFile, repoRecipePath, writeRepoFile } from '../../../../lib/github.ts';

const isAuthorized = async (request: Request, cookies: any) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return null;
  }

  const session = parseAdminSessionCookie(sessionCookie);
  if (!session) return null;

  const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
  if (!(await ensureCsrfToken(request, csrfCookie, secret, session.id))) {
    return null;
  }

  return session;
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

export const POST: APIRoute = async ({ request, cookies }) => {
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

  const updated: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  for (const slug of slugs) {
    const recipePath = repoRecipePath(slug);
    try {
      const file = await getRepoFile(recipePath, 'main');
      if (!file.content) {
        throw new Error('Recipe file content is empty');
      }
      const updatedMarkdown = updateRecipeStatusInMarkdown(file.content, status as 'draft' | 'tested');
      await writeRepoFile(
        recipePath,
        updatedMarkdown,
        `Bulk update status: ${slug} -> ${status}`,
        file.sha,
      );
      updated.push(slug);
    } catch (err) {
      failed.push({
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
