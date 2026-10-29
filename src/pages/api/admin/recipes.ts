import type { APIRoute } from 'astro';

export const prerender = false;
import { getCollection } from 'astro:content';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  slugify,
  verifySessionCookie,
  ensureCsrfToken,
} from '../../../lib/admin';
import { inferRecipeDraft, serializeRecipeToMarkdown } from '../../../lib/recipe-admin';
import { repoRecipePath, writeRepoFile } from '../../../lib/github';

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

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeIngredients(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeInstructions(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function readRecipePayload(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const json = await request.json();
    return json && typeof json === 'object' ? json : {};
  }

  const formData = await request.formData();
  const result: Record<string, unknown> = {};
  for (const [key, raw] of formData.entries()) {
    result[key] = raw instanceof File ? raw.name : String(raw ?? '');
  }
  return result;
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const recipes = await getCollection('recipes');
  return new Response(JSON.stringify(recipes.map((recipe) => ({ slug: recipe.id.replace(/\.md$/, ''), title: recipe.data.title, status: recipe.data.reviewStatus, category: recipe.data.category }))), {
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const data = await readRecipePayload(request);
  const gallery = Array.isArray(data.gallery)
    ? data.gallery
    : typeof data.gallery === 'string'
    ? (() => { try { return JSON.parse(data.gallery); } catch { return []; } })()
    : [];

  const payload = {
    title: String(data.title ?? ''),
    slug: String(data.slug ?? ''),
    description: String(data.description ?? ''),
    category: String(data.category ?? 'easy-dinners'),
    tags: normalizeTags(data.tags),
    image: String(data.image ?? '../../assets/recipes/placeholder.svg'),
    imageAlt: String(data.imageAlt ?? 'CrockBites recipe illustration'),
    gallery: Array.isArray(gallery) ? gallery : [],
    author: String(data.author ?? 'CrockBites'),
    pubDate: String(data.pubDate ?? new Date().toISOString().slice(0, 10)),
    prepMinutes: Number(data.prepMinutes ?? 0),
    cookMinutes: Number(data.cookMinutes ?? 0),
    cookTimeNote: String(data.cookTimeNote ?? ''),
    servings: Number(data.servings ?? 1),
    servingsLabel: String(data.servingsLabel ?? 'servings'),
    ingredients: normalizeIngredients(data.ingredients),
    instructions: normalizeInstructions(data.instructions),
    tips: normalizeTags(data.tips),
    reviewStatus: String(data.reviewStatus ?? 'draft') as 'draft' | 'tested',
  };

  const finalSlug = payload.slug ? slugify(payload.slug) : slugify(payload.title);
  const validation = inferRecipeDraft({
    ...payload,
    slug: finalSlug,
  });

  if (validation.issues.length > 0) {
    return new Response(JSON.stringify({ error: validation.issues.join(' ') }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const recipes = await getCollection('recipes');
  if (recipes.some((recipe) => recipe.id.replace(/\.md$/, '') === finalSlug || recipe.data.title === payload.title)) {
    return new Response(JSON.stringify({ error: `Duplicate slug: ${finalSlug}` }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  const markdown = serializeRecipeToMarkdown({
    ...payload,
    slug: finalSlug,
    reviewStatus: payload.reviewStatus === 'tested' ? 'tested' : 'draft',
    ingredients: payload.ingredients.length ? payload.ingredients : [{ item: 'Example ingredient' }],
    instructions: payload.instructions.length ? payload.instructions : [{ text: 'Add instructions for this recipe.' }],
    tags: payload.tags,
    image: payload.image,
    imageAlt: payload.imageAlt,
    gallery: payload.gallery,
    author: payload.author,
    pubDate: payload.pubDate,
    category: payload.category,
    description: payload.description,
    title: payload.title,
    prepMinutes: payload.prepMinutes,
    cookMinutes: payload.cookMinutes,
    servings: payload.servings,
  });

  try {
    const repoPath = repoRecipePath(finalSlug);
    await writeRepoFile(repoPath, markdown, `Add recipe: ${payload.title}`);
    return new Response(JSON.stringify({ message: 'Recipe created', slug: finalSlug, path: repoPath }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub publishing failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
};
