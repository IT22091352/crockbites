import type { APIRoute } from 'astro';

export const prerender = false;
import { getCollection } from 'astro:content';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ensureCsrfToken,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  slugify,
  verifySessionCookie,
} from '../../../../lib/admin';
import { inferRecipeDraft, serializeRecipeToMarkdown } from '../../../../lib/recipe-admin';
import { deleteRepoFile, getRepoFile, repoRecipePath, writeRepoFile } from '../../../../lib/github';

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
  if (Array.isArray(value)) return value.map((tag) => String(tag ?? '').trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeIngredients(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function normalizeInstructions(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

async function readPayload(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await request.json();
    return json && typeof json === 'object' ? json : {};
  }

  const form = await request.formData();
  const result: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    result[key] = value instanceof File ? value.name : String(value ?? '');
  }
  return result;
}

export const GET: APIRoute = async ({ params, request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const slug = String(params.slug ?? '').trim();
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Recipe slug is required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const recipe = (await getCollection('recipes')).find((entry) => entry.id.replace(/\.md$/, '') === slug || (entry.data.slug ?? '').toLowerCase() === slug.toLowerCase());
  if (!recipe) {
    return new Response(JSON.stringify({ error: 'Recipe not found.' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    slug: recipe.id.replace(/\.md$/, ''),
    title: recipe.data.title,
    description: recipe.data.description,
    category: recipe.data.category,
    tags: recipe.data.tags,
    image: recipe.data.image,
    imageAlt: recipe.data.imageAlt,
    gallery: (recipe.data as any).gallery ?? [],
    author: recipe.data.author,
    pubDate: recipe.data.pubDate.toISOString().slice(0, 10),
    updatedDate: recipe.data.updatedDate?.toISOString().slice(0, 10),
    prepMinutes: recipe.data.prepMinutes,
    cookMinutes: recipe.data.cookMinutes,
    totalMinutes: recipe.data.totalMinutes,
    cookTimeNote: recipe.data.cookTimeNote,
    servings: recipe.data.servings,
    servingsLabel: recipe.data.servingsLabel,
    ingredients: recipe.data.ingredients,
    instructions: recipe.data.instructions,
    tips: recipe.data.tips,
    storage: recipe.data.storage,
    reviewStatus: recipe.data.reviewStatus,
  }), { headers: { 'content-type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const currentSlug = String(params.slug ?? '').trim();
  const data = await readPayload(request);
  const gallery = Array.isArray(data.gallery)
    ? data.gallery
    : typeof data.gallery === 'string'
    ? (() => { try { return JSON.parse(data.gallery); } catch { return []; } })()
    : [];

  const title = String(data.title ?? '');
  const requestedSlug = String(data.slug ?? (currentSlug || title));
  const slug = slugify(requestedSlug || title);
  const payload = {
    title,
    slug,
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

  const validation = inferRecipeDraft({ ...payload, slug });
  if (validation.issues.length > 0) {
    return new Response(JSON.stringify({ error: validation.issues.join(' ') }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const recipePath = repoRecipePath(slug);
  try {
    const prior = await getRepoFile(recipePath, 'main');
    const markdown = serializeRecipeToMarkdown({
      ...payload,
      ingredients: payload.ingredients.length ? payload.ingredients : [{ item: 'Example ingredient' }],
      instructions: payload.instructions.length ? payload.instructions : [{ text: 'Add instructions for this recipe.' }],
      reviewStatus: payload.reviewStatus === 'tested' ? 'tested' : 'draft',
      image: payload.image,
      imageAlt: payload.imageAlt,
      gallery: payload.gallery,
      tags: payload.tags,
      author: payload.author,
      pubDate: payload.pubDate,
      category: payload.category,
      title: payload.title,
    });
    const response = await writeRepoFile(recipePath, markdown, `Update recipe: ${payload.title}`, prior.sha);
    return new Response(JSON.stringify({ message: 'Recipe updated', slug, sha: response.content?.sha ?? response.commit?.sha ?? null }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub update failed';
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const slug = String(params.slug ?? '').trim();
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Recipe slug is required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const recipePath = repoRecipePath(slug);
  try {
    const file = await getRepoFile(recipePath, 'main');
    await deleteRepoFile(recipePath, file.sha, `Delete recipe: ${slug}`);
    return new Response(JSON.stringify({ message: 'Recipe deleted', slug }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub delete failed';
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
};
