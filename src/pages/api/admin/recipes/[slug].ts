import type { APIRoute } from 'astro';

export const prerender = false;
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ensureCsrfToken,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  slugify,
  verifySessionCookie,
  verifyAdminSession,
} from '../../../../lib/admin';
import {
  inferRecipeDraft,
  normalizeDietaryLabels,
  normalizeAllergens,
  type FrontmatterRecipe,
} from '../../../../lib/recipe-admin';
import { cleanupUnusedRecipeMedia } from '../../../../lib/cloudinary';
import { getDb } from '../../../../lib/db';
import { migrateRecipeSlugInCommunityDb } from '../../../../lib/community';
import { triggerRecipeNewsletterCampaign } from '../../../../lib/brevo-campaign';
import {
  formatAdminRecipeSummary,
  saveAdminRecipeCache,
  removeAdminRecipeCache,
  saveAdminFullRecipeCache,
} from '../../../../lib/admin-recipes';
import {
  getRecipeBySlugFromDb,
  getAllRecipesFromDb,
  updateRecipeInDb,
  deleteRecipeInDb,
  formatRecipeSummary,
  invalidateRecipeMemoryCache,
} from '../../../../lib/recipes-db';

const isAuthorized = async (request: Request, cookies: any) => {
  // Safe HTTP methods (RFC 9110) do not mutate state and do not require CSRF token
  const requireCsrf = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
  return verifyAdminSession(request, cookies, { requireCsrf });
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

export const GET: APIRoute = async ({ params, request, cookies, locals }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const slug = String(params.slug ?? '').trim();
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Recipe slug is required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const db = await getDb(locals);
  const recipe = db ? await getRecipeBySlugFromDb(db, slug) : null;

  if (recipe) {
    return new Response(JSON.stringify({
      slug: recipe.data.slug,
      title: recipe.data.title,
      description: recipe.data.description,
      category: recipe.data.category,
      tags: recipe.data.tags,
      image: recipe.data.image,
      imageAlt: recipe.data.imageAlt,
      gallery: recipe.data.gallery,
      author: recipe.data.author,
      pubDate: recipe.data.pubDate instanceof Date ? recipe.data.pubDate.toISOString().slice(0, 10) : recipe.data.pubDate,
      updatedDate: recipe.data.updatedDate instanceof Date ? recipe.data.updatedDate.toISOString().slice(0, 10) : recipe.data.updatedDate,
      prepMinutes: recipe.data.prepMinutes,
      cookMinutes: recipe.data.cookMinutes,
      totalMinutes: recipe.data.totalMinutes,
      cookTimeNote: recipe.data.cookTimeNote,
      servings: recipe.data.servings,
      servingsLabel: recipe.data.servingsLabel,
      ingredients: recipe.data.ingredients,
      instructions: recipe.data.instructions,
      servingSuggestions: recipe.data.servingSuggestions ?? [],
      tips: recipe.data.tips ?? [],
      substitutions: recipe.data.substitutions ?? [],
      storage: recipe.data.storage ?? {},
      equipment: recipe.data.equipment ?? [],
      foodSafety: recipe.data.foodSafety ?? [],
      dietaryLabels: recipe.data.dietaryLabels ?? [],
      dietaryVerified: recipe.data.dietaryVerified ?? false,
      allergens: recipe.data.allergens ?? [],
      allergenReviewed: recipe.data.allergenReviewed ?? false,
      allergenNotes: recipe.data.allergenNotes ?? '',
      nutrition: recipe.data.nutrition ?? null,
      featured: recipe.data.featured ?? false,
      popularRank: recipe.data.popularRank,
      related: recipe.data.related ?? [],
      reviewStatus: recipe.data.reviewStatus,
      body: recipe.body ?? '',
    }), { headers: { 'content-type': 'application/json' } });
  }

  // Fallback to Astro static collection
  try {
    const { getCollection } = await import('astro:content');
    const staticRecipe = (await getCollection('recipes')).find(
      (entry) => entry.id.replace(/\.md$/, '') === slug || (entry.data.slug ?? '').toLowerCase() === slug.toLowerCase()
    );
    if (staticRecipe) {
      return new Response(JSON.stringify({
        slug: staticRecipe.id.replace(/\.md$/, ''),
        title: staticRecipe.data.title,
        description: staticRecipe.data.description,
        category: staticRecipe.data.category,
        tags: staticRecipe.data.tags,
        image: typeof staticRecipe.data.image === 'string' ? staticRecipe.data.image : (staticRecipe.data.image as any)?.src,
        imageAlt: staticRecipe.data.imageAlt,
        gallery: staticRecipe.data.gallery,
        author: staticRecipe.data.author,
        pubDate: staticRecipe.data.pubDate,
        updatedDate: staticRecipe.data.updatedDate,
        prepMinutes: staticRecipe.data.prepMinutes,
        cookMinutes: staticRecipe.data.cookMinutes,
        totalMinutes: staticRecipe.data.totalMinutes,
        cookTimeNote: staticRecipe.data.cookTimeNote,
        servings: staticRecipe.data.servings,
        servingsLabel: staticRecipe.data.servingsLabel,
        ingredients: staticRecipe.data.ingredients,
        instructions: staticRecipe.data.instructions,
        servingSuggestions: staticRecipe.data.servingSuggestions ?? [],
        tips: staticRecipe.data.tips ?? [],
        substitutions: staticRecipe.data.substitutions ?? [],
        storage: staticRecipe.data.storage ?? {},
        equipment: staticRecipe.data.equipment ?? [],
        foodSafety: staticRecipe.data.foodSafety ?? [],
        dietaryLabels: staticRecipe.data.dietaryLabels ?? [],
        dietaryVerified: staticRecipe.data.dietaryVerified ?? false,
        allergens: staticRecipe.data.allergens ?? [],
        allergenReviewed: staticRecipe.data.allergenReviewed ?? false,
        allergenNotes: staticRecipe.data.allergenNotes ?? '',
        nutrition: staticRecipe.data.nutrition ?? null,
        featured: staticRecipe.data.featured ?? false,
        popularRank: staticRecipe.data.popularRank,
        related: staticRecipe.data.related ?? [],
        reviewStatus: staticRecipe.data.reviewStatus,
        body: staticRecipe.body ?? '',
      }), { headers: { 'content-type': 'application/json' } });
    }
  } catch {}

  return new Response(JSON.stringify({ error: 'Recipe not found.' }), { status: 404, headers: { 'content-type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, cookies, locals }) => {
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

  const hasNutritionKey = Object.prototype.hasOwnProperty.call(data, 'nutrition');
  const nutrition = data.nutrition === null
    ? undefined
    : typeof data.nutrition === 'string'
    ? (() => { try { return JSON.parse(data.nutrition); } catch { return undefined; } })()
    : data.nutrition && typeof data.nutrition === 'object'
    ? data.nutrition
    : undefined;

  const title = String(data.title ?? '');
  const requestedSlug = String(data.slug ?? (currentSlug || title));
  const slug = slugify(requestedSlug || title);

  const updates: Partial<FrontmatterRecipe> & Record<string, unknown> = {
    title,
    slug,
    description: String(data.description ?? ''),
    category: String(data.category ?? 'easy-dinners'),
    tags: normalizeTags(data.tags),
    image: String(data.image ?? '../../assets/recipes/placeholder.svg'),
    imageAlt: String(data.imageAlt ?? 'CrockBites recipe illustration'),
    gallery: Array.isArray(gallery) ? gallery : [],
    author: String(data.author ?? 'CrockBites'),
    ...(data.pubDate !== undefined ? { pubDate: String(data.pubDate) } : {}),
    updatedDate: new Date().toISOString().slice(0, 10),
    prepMinutes: Number(data.prepMinutes ?? 0),
    cookMinutes: Number(data.cookMinutes ?? 0),
    servings: Number(data.servings ?? 1),
    ingredients: normalizeIngredients(data.ingredients),
    instructions: normalizeInstructions(data.instructions),
    dietaryLabels: normalizeDietaryLabels(data.dietaryLabels),
    dietaryVerified: Boolean(data.dietaryVerified),
    allergens: normalizeAllergens(data.allergens),
    allergenReviewed: Boolean(data.allergenReviewed),
    reviewStatus: String(data.reviewStatus ?? 'draft') as 'draft' | 'tested',
  };

  if (Object.prototype.hasOwnProperty.call(data, 'allergenNotes')) {
    updates.allergenNotes = data.allergenNotes == null ? '' : String(data.allergenNotes).trim();
  }
  if (hasNutritionKey) {
    updates.nutrition = nutrition;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'totalMinutes')) {
    updates.totalMinutes = data.totalMinutes === '' || data.totalMinutes == null ? undefined : Number(data.totalMinutes);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'cookTimeNote')) {
    updates.cookTimeNote = data.cookTimeNote == null ? '' : String(data.cookTimeNote).trim();
  }
  if (Object.prototype.hasOwnProperty.call(data, 'servingsLabel')) {
    updates.servingsLabel = data.servingsLabel == null ? '' : String(data.servingsLabel).trim();
  }
  if (Object.prototype.hasOwnProperty.call(data, 'tips')) {
    updates.tips = normalizeTags(data.tips);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'servingSuggestions') && Array.isArray(data.servingSuggestions)) {
    updates.servingSuggestions = data.servingSuggestions.map((s: unknown) => String(s ?? '').trim()).filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'substitutions') && Array.isArray(data.substitutions)) {
    updates.substitutions = data.substitutions;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'storage') && data.storage && typeof data.storage === 'object') {
    updates.storage = data.storage as FrontmatterRecipe['storage'];
  }
  if (Object.prototype.hasOwnProperty.call(data, 'equipment') && Array.isArray(data.equipment)) {
    updates.equipment = data.equipment.map((s: unknown) => String(s ?? '').trim()).filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'foodSafety') && Array.isArray(data.foodSafety)) {
    updates.foodSafety = data.foodSafety.map((s: unknown) => String(s ?? '').trim()).filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'featured')) {
    updates.featured = Boolean(data.featured);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'popularRank')) {
    updates.popularRank = data.popularRank === '' || data.popularRank == null ? undefined : Number(data.popularRank);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'related') && Array.isArray(data.related)) {
    updates.related = data.related.map((s: unknown) => String(s ?? '').trim()).filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'body')) {
    updates.body = String(data.body ?? '');
  }

  const db = await getDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database is not available.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }

  const existing = await getRecipeBySlugFromDb(db, currentSlug);
  if (!existing) {
    return new Response(JSON.stringify({ error: `Recipe "${currentSlug}" does not exist in D1.` }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  // Check if renaming to a slug that belongs to another recipe
  if (slug !== currentSlug) {
    const slugConflict = await getRecipeBySlugFromDb(db, slug);
    if (slugConflict) {
      return new Response(JSON.stringify({ error: `Cannot rename: a recipe with slug "${slug}" already exists.` }), { status: 409, headers: { 'content-type': 'application/json' } });
    }
  }

  const isTransitionToPublished = existing.data.reviewStatus !== 'tested' && updates.reviewStatus === 'tested';
  const validation = inferRecipeDraft({ ...existing.data, ...updates, slug, pubDate: existing.data.pubDate instanceof Date ? existing.data.pubDate.toISOString().slice(0, 10) : String(existing.data.pubDate || '') } as any);
  if (validation.issues.length > 0) {
    return new Response(JSON.stringify({ error: validation.issues.join(' ') }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const isNewsletterOptedIn = data.notifyNewsletter !== undefined
    ? Boolean(data.notifyNewsletter)
    : (data.sendNewsletter !== false && data.sendNewsletter !== 'false' && data.sendNewsletter !== 0);

  try {
    // If slug changed, migrate references in community tables (favorites, reviews, collections)
    if (currentSlug && slug !== currentSlug) {
      await migrateRecipeSlugInCommunityDb(db, currentSlug, slug);
      removeAdminRecipeCache(currentSlug);
    }

    // Update in Cloudflare D1
    const updatedRecipe = await updateRecipeInDb(db, currentSlug, {
      ...updates,
      slug,
      notifyNewsletter: isNewsletterOptedIn,
    } as any);

    const recipeSummary = formatRecipeSummary(updatedRecipe);
    saveAdminRecipeCache(recipeSummary);
    saveAdminFullRecipeCache(slug, updatedRecipe as any);
    invalidateRecipeMemoryCache();

    // Trigger newsletter campaign only if newly published and opted in
    let newsletterResult: any = undefined;
    if (isTransitionToPublished && isNewsletterOptedIn) {
      try {
        newsletterResult = await triggerRecipeNewsletterCampaign(db, {
          slug,
          title: updatedRecipe.data.title,
          description: updatedRecipe.data.description,
          image: updatedRecipe.data.image,
          imageAlt: updatedRecipe.data.imageAlt,
          prepMinutes: updatedRecipe.data.prepMinutes,
          cookMinutes: updatedRecipe.data.cookMinutes,
          servings: updatedRecipe.data.servings,
          category: updatedRecipe.data.category,
        });
      } catch (err) {
        console.error('[Admin Recipe PUT] Newsletter campaign trigger error:', err);
      }
    }

    return new Response(JSON.stringify({
      message: 'Recipe updated',
      slug,
      recipe: recipeSummary,
      newsletter: newsletterResult,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'D1 update failed';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ params, request, cookies, locals }) => {
  const session = await isAuthorized(request, cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized or CSRF validation failed.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const slug = String(params.slug ?? '').trim();
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Recipe slug is required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const db = await getDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database is not available.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }

  try {
    const existing = await getRecipeBySlugFromDb(db, slug);
    if (!existing) {
      return new Response(JSON.stringify({ error: `Recipe "${slug}" not found in D1.` }), { status: 404, headers: { 'content-type': 'application/json' } });
    }

    const allRecipes = await getAllRecipesFromDb(db, { includeDrafts: true });
    const otherRecipes = allRecipes.filter((r) => r.slug.toLowerCase() !== slug.toLowerCase());

    // Clean up unused Cloudinary media
    let mediaCleanup: { candidateCount: number; unusedCount: number; results: any[] } = {
      candidateCount: 0,
      unusedCount: 0,
      results: [],
    };

    try {
      const getImageSrc = (img: unknown): string | undefined => {
        if (typeof img === 'string') return img;
        if (img && typeof img === 'object' && 'src' in img) return String((img as any).src);
        return undefined;
      };

      mediaCleanup = await cleanupUnusedRecipeMedia(
        {
          image: getImageSrc(existing.data.image),
          gallery: (existing.data as any).gallery,
        },
        otherRecipes.map((r) => ({
          image: getImageSrc(r.data.image),
          gallery: (r.data as any).gallery,
        })),
      );
    } catch (cleanupErr) {
      mediaCleanup = {
        candidateCount: 0,
        unusedCount: 0,
        results: [{
          publicId: 'all',
          status: 'failed',
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        }],
      };
    }

    // Delete from D1
    await deleteRecipeInDb(db, slug);
    removeAdminRecipeCache(slug);
    invalidateRecipeMemoryCache();

    return new Response(JSON.stringify({
      message: `Recipe "${slug}" deleted from D1.`,
      mediaCleanup,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'D1 delete failed';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
