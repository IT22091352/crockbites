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
import {
  inferRecipeDraft,
  mergeExistingRecipeWithUpdates,
  normalizeDietaryLabels,
  normalizeAllergens,
  serializeRecipeToMarkdown,
  type FrontmatterRecipe,
} from '../../../../lib/recipe-admin';
import { deleteRepoFile, getRepoFile, repoRecipePath, writeRepoFile } from '../../../../lib/github';
import { cleanupUnusedRecipeMedia } from '../../../../lib/cloudinary';
import { getDb } from '../../../../lib/db';
import { migrateRecipeSlugInCommunityDb } from '../../../../lib/community';

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
    image: typeof recipe.data.image === 'string' ? recipe.data.image : recipe.data.image.src,
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

  const currentRecipePath = repoRecipePath(currentSlug || slug);
  const targetRecipePath = repoRecipePath(slug);

  try {
    const prior = await getRepoFile(currentRecipePath, 'main');
    const existingMarkdown = prior.content ? Buffer.from(prior.content, 'base64').toString('utf8') : '';
    const mergedRecipe = mergeExistingRecipeWithUpdates(existingMarkdown, updates);

    const validation = inferRecipeDraft({ ...mergedRecipe, slug });
    if (validation.issues.length > 0) {
      return new Response(JSON.stringify({ error: validation.issues.join(' ') }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    const markdown = serializeRecipeToMarkdown({
      ...mergedRecipe,
      slug,
      ingredients: mergedRecipe.ingredients.length ? mergedRecipe.ingredients : [{ item: 'Example ingredient' }],
      instructions: mergedRecipe.instructions.length ? mergedRecipe.instructions : [{ text: 'Add instructions for this recipe.' }],
      reviewStatus: mergedRecipe.reviewStatus === 'tested' ? 'tested' : 'draft',
    });

    if (targetRecipePath === currentRecipePath) {
      const response = await writeRepoFile(targetRecipePath, markdown, `Update recipe: ${mergedRecipe.title}`, prior.sha);
      return new Response(JSON.stringify({ message: 'Recipe updated', slug, sha: response.content?.sha ?? response.commit?.sha ?? null }), { status: 200, headers: { 'content-type': 'application/json' } });
    } else {
      let targetSha: string | undefined;
      try {
        const existingTarget = await getRepoFile(targetRecipePath, 'main');
        targetSha = existingTarget.sha;
      } catch {
        targetSha = undefined;
      }
      const response = await writeRepoFile(targetRecipePath, markdown, `Rename & update recipe: ${mergedRecipe.title}`, targetSha);
      await deleteRepoFile(currentRecipePath, prior.sha, `Remove old recipe path after rename: ${currentSlug}`);

      const db = await getDb(locals);
      if (db && currentSlug && slug !== currentSlug) {
        await migrateRecipeSlugInCommunityDb(db, currentSlug, slug);
      }

      return new Response(JSON.stringify({ message: 'Recipe updated', slug, sha: response.content?.sha ?? response.commit?.sha ?? null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
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

    // Parse the target recipe and all other recipes to find orphaned Cloudinary media
    const allRecipes = await getCollection('recipes');
    const targetRecipe = allRecipes.find((entry) => entry.id.replace(/\.md$/, '') === slug || (entry.data.slug ?? '').toLowerCase() === slug.toLowerCase());
    const otherRecipes = allRecipes.filter((entry) => entry.id.replace(/\.md$/, '') !== slug && (entry.data.slug ?? '').toLowerCase() !== slug.toLowerCase());

    // CRITICAL: First delete recipe file from GitHub. Only if this succeeds do we clean up Cloudinary assets!
    await deleteRepoFile(recipePath, file.sha, `Delete recipe: ${slug}`);

    // Recipe confirmed deleted from GitHub repository. Now safely clean up confirmed unused Cloudinary assets:
    let mediaCleanup: { candidateCount: number; unusedCount: number; results: any[] } = {
      candidateCount: 0,
      unusedCount: 0,
      results: [],
    };

    if (targetRecipe) {
      try {
        const getImageSrc = (img: unknown): string | undefined => {
          if (typeof img === 'string') return img;
          if (img && typeof img === 'object' && 'src' in img) return String((img as any).src);
          return undefined;
        };

        mediaCleanup = await cleanupUnusedRecipeMedia(
          {
            image: getImageSrc(targetRecipe.data.image),
            gallery: (targetRecipe.data as any).gallery,
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
    }

    return new Response(JSON.stringify({
      message: 'Recipe deleted',
      slug,
      mediaCleanup,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub delete failed';
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
};
