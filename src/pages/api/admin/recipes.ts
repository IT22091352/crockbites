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
import { inferRecipeDraft, normalizeDietaryLabels, normalizeAllergens, serializeRecipeToMarkdown } from '../../../lib/recipe-admin';
import { getRepoFile, repoRecipePath, writeRepoFile } from '../../../lib/github';
import { getDb } from '../../../lib/db';
import { triggerRecipeNewsletterCampaign } from '../../../lib/brevo-campaign';
import { formatAdminRecipeSummary, getAdminRecipeList, saveAdminRecipeCache, saveAdminFullRecipeCache, parseRecipeMarkdownToFull } from '../../../lib/admin-recipes';

const isAuthorized = async (request: Request, cookies: any) => {
  const secret = getAdminSessionSecret();
  const sessionCookie = cookies.get(ADMIN_COOKIE_NAME)?.value ?? '';
  if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) {
    return null;
  }

  const session = parseAdminSessionCookie(sessionCookie);
  if (!session) return null;

  // Safe HTTP methods (RFC 9110) do not mutate state and do not require CSRF token
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    const csrfCookie = cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
    if (!(await ensureCsrfToken(request, csrfCookie, secret, session.id))) {
      return null;
    }
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

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const isFresh = url.searchParams.get('fresh') === 'true' || url.searchParams.get('fresh') === '1';
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();

  const allRecipes = await getAdminRecipeList({ fresh: isFresh });
  let recipes = allRecipes;

  if (statusFilter && statusFilter !== 'all') {
    recipes = recipes.filter((r) => r.reviewStatus === statusFilter);
  }

  if (query) {
    recipes = recipes.filter(
      (r) => r.title.toLowerCase().includes(query) || r.slug.toLowerCase().includes(query)
    );
  }

  return new Response(JSON.stringify({ success: true, count: recipes.length, recipes }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
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

  const nutrition = typeof data.nutrition === 'string'
    ? (() => { try { return JSON.parse(data.nutrition); } catch { return undefined; } })()
    : data.nutrition && typeof data.nutrition === 'object'
    ? data.nutrition
    : undefined;

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
    foodSafety: Array.isArray(data.foodSafety) ? data.foodSafety.map((s: unknown) => String(s ?? '').trim()).filter(Boolean) : [],
    equipment: Array.isArray(data.equipment) ? data.equipment.map((s: unknown) => String(s ?? '').trim()).filter(Boolean) : [],
    servingSuggestions: Array.isArray(data.servingSuggestions) ? data.servingSuggestions.map((s: unknown) => String(s ?? '').trim()).filter(Boolean) : [],
    substitutions: Array.isArray(data.substitutions) ? data.substitutions : [],
    storage: data.storage && typeof data.storage === 'object' ? (data.storage as any) : undefined,
    body: typeof data.body === 'string' ? data.body : undefined,
    dietaryLabels: normalizeDietaryLabels(data.dietaryLabels),
    dietaryVerified: Boolean(data.dietaryVerified),
    allergens: normalizeAllergens(data.allergens),
    allergenReviewed: Boolean(data.allergenReviewed),
    allergenNotes: data.allergenNotes ? String(data.allergenNotes).trim() : undefined,
    nutrition,
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

  try {
    const existingFile = await getRepoFile(repoRecipePath(finalSlug), 'main');
    if (existingFile && existingFile.sha) {
      return new Response(JSON.stringify({ error: `Duplicate slug: ${finalSlug} already exists.` }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch {}

  const isNewsletterOptedIn = data.notifyNewsletter !== undefined
    ? Boolean(data.notifyNewsletter)
    : (data.sendNewsletter !== false && data.sendNewsletter !== 'false' && data.sendNewsletter !== 0);

  const markdown = serializeRecipeToMarkdown({
    ...payload,
    slug: finalSlug,
    notifyNewsletter: isNewsletterOptedIn,
    reviewStatus: payload.reviewStatus === 'tested' ? 'tested' : 'draft',
    ingredients: payload.ingredients.length ? payload.ingredients : [{ item: 'Example ingredient' }],
    instructions: payload.instructions.length ? payload.instructions : [{ text: 'Add instructions for this recipe.' }],
  });

  try {
    const repoPath = repoRecipePath(finalSlug);
    await writeRepoFile(repoPath, markdown, `Add recipe: ${payload.title}`);

    // If running in local node environment with accessible filesystem, write file locally as well
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const localDir = path.resolve(process.cwd(), 'src/content/recipes');
      if (fs.existsSync(localDir)) {
        fs.writeFileSync(path.join(localDir, `${finalSlug}.md`), markdown, 'utf8');
      }
    } catch {
      // Worker environment or read-only filesystem
    }

    // Format rich recipe summary and cache for immediate retrieval
    const recipeSummary = formatAdminRecipeSummary({
      slug: finalSlug,
      title: payload.title,
      description: payload.description,
      category: payload.category,
      reviewStatus: payload.reviewStatus,
      image: payload.image,
      pubDate: payload.pubDate,
      updatedDate: new Date().toISOString(),
      ingredients: payload.ingredients,
      instructions: payload.instructions,
    });
    saveAdminRecipeCache(recipeSummary);
    const parsedFull = parseRecipeMarkdownToFull(finalSlug, markdown);
    if (parsedFull) {
      saveAdminFullRecipeCache(finalSlug, parsedFull);
    }

    // Trigger newsletter campaign if published and opted in
    let newsletterResult: any = undefined;
    const sendNewsletter = isNewsletterOptedIn;

    if (payload.reviewStatus === 'tested') {
      if (sendNewsletter) {
        try {
          const db = await getDb(locals);
          newsletterResult = await triggerRecipeNewsletterCampaign(db, {
            slug: finalSlug,
            title: payload.title,
            description: payload.description,
            image: payload.image,
            imageAlt: payload.imageAlt,
            prepMinutes: payload.prepMinutes,
            cookMinutes: payload.cookMinutes,
            servings: payload.servings,
            category: payload.category,
          });
        } catch (err) {
          console.error('[Admin Recipe POST] Newsletter campaign trigger error:', err);
          newsletterResult = {
            ok: false,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      } else {
        newsletterResult = {
          ok: true,
          status: 'skipped',
          reason: 'disabled_by_user',
        };
      }
    } else {
      newsletterResult = {
        ok: true,
        status: 'skipped',
        reason: 'draft',
      };
    }

    return new Response(JSON.stringify({
      message: 'Recipe created',
      slug: finalSlug,
      path: repoPath,
      recipe: recipeSummary,
      newsletter: newsletterResult,
    }), {
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
