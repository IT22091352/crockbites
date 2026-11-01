import type { APIRoute } from 'astro';

export const prerender = false;
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  slugify,
  verifySessionCookie,
  ensureCsrfToken,
  verifyAdminSession,
} from '../../../lib/admin';
import { inferRecipeDraft, normalizeDietaryLabels, normalizeAllergens } from '../../../lib/recipe-admin';
import { getDb } from '../../../lib/db';
import { triggerRecipeNewsletterCampaign } from '../../../lib/brevo-campaign';
import {
  getAdminRecipeList,
  saveAdminRecipeCache,
  saveAdminFullRecipeCache,
} from '../../../lib/admin-recipes';
import {
  createRecipeInDb,
  getRecipeBySlugFromDb,
  formatRecipeSummary,
  invalidateRecipeMemoryCache,
} from '../../../lib/recipes-db';

const isAuthorized = async (request: Request, cookies: any) => {
  // Safe HTTP methods (RFC 9110) do not mutate state and do not require CSRF token
  const requireCsrf = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
  return verifyAdminSession(request, cookies, { requireCsrf });
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

  const db = await getDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database is not available.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Duplicate slug check in Cloudflare D1
  const existing = await getRecipeBySlugFromDb(db, finalSlug);
  if (existing) {
    return new Response(JSON.stringify({ error: `Duplicate slug: ${finalSlug} already exists.` }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  const isNewsletterOptedIn = data.notifyNewsletter !== undefined
    ? Boolean(data.notifyNewsletter)
    : (data.sendNewsletter !== false && data.sendNewsletter !== 'false' && data.sendNewsletter !== 0);

  try {
    // Save directly to Cloudflare D1
    const createdRecipe = await createRecipeInDb(db, {
      ...payload,
      pubDate: new Date(payload.pubDate),
      slug: finalSlug,
      ingredients: payload.ingredients.length ? payload.ingredients : [{ item: 'Example ingredient' }],
      instructions: payload.instructions.length ? payload.instructions : [{ text: 'Add instructions for this recipe.' }],
      reviewStatus: payload.reviewStatus === 'tested' ? 'tested' : 'draft',
      notifyNewsletter: isNewsletterOptedIn,
    });

    const summary = formatRecipeSummary(createdRecipe);
    saveAdminRecipeCache(summary);
    saveAdminFullRecipeCache(finalSlug, createdRecipe as any);
    invalidateRecipeMemoryCache();

    // Trigger newsletter campaign if published and opted in
    let newsletterResult: any = undefined;
    if (payload.reviewStatus === 'tested' && isNewsletterOptedIn) {
      try {
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
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        slug: finalSlug,
        recipe: summary,
        newsletter: newsletterResult,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create recipe in D1';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
