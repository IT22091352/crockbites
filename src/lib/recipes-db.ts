import type { D1Database } from './db.ts';
import { getOptimizedCloudinaryUrl } from './cloudinary.ts';

export const CATEGORY_MAP: Record<string, string> = {
  'slow-cooker-chicken': 'Slow Cooker Chicken',
  'beef-pork': 'Beef & Pork',
  'soups-stews': 'Soups & Stews',
  'easy-dinners': 'Easy Dinners',
  'breakfast': 'Breakfast',
  'vegetarian': 'Vegetarian',
  'desserts-baking': 'Desserts & Baking',
};

export interface DbRecipeRow {
  slug: string;
  title: string;
  seo_title: string | null;
  description: string;
  seo_description: string | null;
  category: string;
  tags: string;
  author: string;
  image_url: string;
  image_alt: string;
  gallery: string;
  prep_minutes: number;
  cook_minutes: number;
  total_minutes: number | null;
  cook_time_note: string | null;
  servings: number;
  servings_label: string;
  ingredients: string;
  instructions: string;
  serving_suggestions: string;
  tips: string;
  substitutions: string;
  storage: string;
  equipment: string;
  food_safety: string;
  dietary_labels: string;
  dietary_verified: number;
  allergens: string;
  allergen_reviewed: number;
  allergen_notes: string | null;
  nutrition: string | null;
  featured: number;
  popular_rank: number | null;
  related: string;
  notify_newsletter: number;
  review_status: 'draft' | 'tested';
  body: string;
  pub_date: string;
  updated_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeData {
  title: string;
  slug: string;
  seoTitle?: string;
  description: string;
  seoDescription?: string;
  category: string;
  tags: string[];
  author: string;
  image: string;
  imageAlt: string;
  gallery: Array<{
    url: string;
    publicId?: string;
    alt: string;
    width?: number;
    height?: number;
    isPrimary?: boolean;
  }>;
  prepMinutes: number;
  cookMinutes: number;
  totalMinutes?: number;
  cookTimeNote?: string;
  servings: number;
  servingsLabel: string;
  ingredients: Array<{
    item: string;
    quantity?: number;
    unit?: string;
    note?: string;
    alt?: string;
    group?: string;
    scale?: boolean;
    itemPlural?: string;
  }>;
  instructions: Array<{
    title?: string;
    text: string;
  }>;
  servingSuggestions: string[];
  tips: string[];
  substitutions: Array<{
    ingredient: string;
    swap: string;
  }>;
  storage: {
    fridge?: string;
    freezer?: string;
    reheating?: string;
  };
  equipment: string[];
  foodSafety: string[];
  dietaryLabels: string[];
  dietaryVerified: boolean;
  allergens: string[];
  allergenReviewed: boolean;
  allergenNotes?: string;
  nutrition?: Record<string, any>;
  featured: boolean;
  popularRank?: number;
  related: string[];
  notifyNewsletter: boolean;
  sendNewsletter?: boolean;
  reviewStatus: 'draft' | 'tested';
  pubDate: Date;
  updatedDate?: Date;
  createdAt?: string;
  updatedAt?: string;
}

export interface FullRecipe {
  id: string;
  slug: string;
  body: string;
  data: RecipeData;
}

export interface AdminRecipeSummary {
  slug: string;
  title: string;
  description: string;
  category: string;
  categoryName: string;
  reviewStatus: 'draft' | 'tested';
  imageUrl: string;
  thumbUrl: string;
  formattedDate: string;
  updatedDate: string;
  pubDate: string;
  ingredientsCount?: number;
  instructionsCount?: number;
}

// In-memory cache for fast read resolution in edge worker instances
let memoryCache: {
  recipes: FullRecipe[];
  timestamp: number;
} | null = null;

const CACHE_TTL_MS = 15 * 1000; // 15 seconds runtime cache

export function invalidateRecipeMemoryCache() {
  memoryCache = null;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed != null ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function rowToFullRecipe(row: DbRecipeRow): FullRecipe {
  const pubDateObj = new Date(row.pub_date || row.created_at || Date.now());
  const updatedDateObj = row.updated_date ? new Date(row.updated_date) : undefined;

  const validPubDate = isNaN(pubDateObj.getTime()) ? new Date() : pubDateObj;
  const validUpdatedDate = updatedDateObj && !isNaN(updatedDateObj.getTime()) ? updatedDateObj : undefined;

  const tags = safeJsonParse<string[]>(row.tags, []);
  const gallery = safeJsonParse<any[]>(row.gallery, []);
  const ingredients = safeJsonParse<any[]>(row.ingredients, []);
  const instructions = safeJsonParse<any[]>(row.instructions, []);
  const servingSuggestions = safeJsonParse<string[]>(row.serving_suggestions, []);
  const tips = safeJsonParse<string[]>(row.tips, []);
  const substitutions = safeJsonParse<any[]>(row.substitutions, []);
  const storage = safeJsonParse<Record<string, string>>(row.storage, {});
  const equipment = safeJsonParse<string[]>(row.equipment, []);
  const foodSafety = safeJsonParse<string[]>(row.food_safety, []);
  const dietaryLabels = safeJsonParse<string[]>(row.dietary_labels, []);
  const allergens = safeJsonParse<string[]>(row.allergens, []);
  const nutrition = safeJsonParse<Record<string, any> | undefined>(row.nutrition, undefined);
  const related = safeJsonParse<string[]>(row.related, []);

  return {
    id: `${row.slug}.md`,
    slug: row.slug,
    body: row.body || '',
    data: {
      title: row.title,
      slug: row.slug,
      seoTitle: row.seo_title || undefined,
      description: row.description,
      seoDescription: row.seo_description || undefined,
      category: row.category,
      tags,
      author: row.author || 'CrockBites',
      image: row.image_url,
      imageAlt: row.image_alt || row.title,
      gallery,
      prepMinutes: row.prep_minutes,
      cookMinutes: row.cook_minutes,
      totalMinutes: row.total_minutes ?? (row.prep_minutes + row.cook_minutes),
      cookTimeNote: row.cook_time_note || undefined,
      servings: row.servings,
      servingsLabel: row.servings_label || 'servings',
      ingredients,
      instructions,
      servingSuggestions,
      tips,
      substitutions,
      storage,
      equipment,
      foodSafety,
      dietaryLabels,
      dietaryVerified: Boolean(row.dietary_verified),
      allergens,
      allergenReviewed: Boolean(row.allergen_reviewed),
      allergenNotes: row.allergen_notes || undefined,
      nutrition,
      featured: Boolean(row.featured),
      popularRank: row.popular_rank ?? undefined,
      related,
      notifyNewsletter: Boolean(row.notify_newsletter),
      sendNewsletter: Boolean(row.notify_newsletter),
      reviewStatus: row.review_status === 'tested' ? 'tested' : 'draft',
      pubDate: validPubDate,
      updatedDate: validUpdatedDate,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export function formatRecipeSummary(recipe: FullRecipe): AdminRecipeSummary {
  const d = recipe.data;
  const isCloudinary = d.image.startsWith('http://') || d.image.startsWith('https://');
  const thumbUrl = isCloudinary ? getOptimizedCloudinaryUrl(d.image, 160) : d.image;

  const dateToFormat = d.updatedDate || d.pubDate;
  const formattedDate = dateToFormat.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    slug: d.slug,
    title: d.title,
    description: d.description,
    category: d.category,
    categoryName: CATEGORY_MAP[d.category] || d.category,
    reviewStatus: d.reviewStatus,
    imageUrl: d.image,
    thumbUrl,
    formattedDate,
    updatedDate: d.updatedDate ? d.updatedDate.toISOString() : d.pubDate.toISOString(),
    pubDate: d.pubDate.toISOString().slice(0, 10),
    ingredientsCount: d.ingredients.length,
    instructionsCount: d.instructions.length,
  };
}

export async function getAllRecipesFromDb(
  db: D1Database | null,
  options: { includeDrafts?: boolean; category?: string; query?: string; bypassCache?: boolean } = {}
): Promise<FullRecipe[]> {
  if (!db) return [];

  const now = Date.now();
  if (!options.bypassCache && memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
    let result = memoryCache.recipes;
    if (!options.includeDrafts) {
      result = result.filter((r) => r.data.reviewStatus === 'tested');
    }
    if (options.category && options.category !== 'all') {
      result = result.filter((r) => r.data.category === options.category);
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      result = result.filter(
        (r) => r.data.title.toLowerCase().includes(q) || r.data.slug.toLowerCase().includes(q)
      );
    }
    return result;
  }

  try {
    const rowsRes = await db
      .prepare('SELECT * FROM recipes ORDER BY pub_date DESC, title ASC')
      .all<DbRecipeRow>();

    const all = (rowsRes.results ?? []).map(rowToFullRecipe);

    // Update in-memory cache with all items
    memoryCache = {
      recipes: all,
      timestamp: now,
    };

    let result = all;
    if (!options.includeDrafts) {
      result = result.filter((r) => r.data.reviewStatus === 'tested');
    }
    if (options.category && options.category !== 'all') {
      result = result.filter((r) => r.data.category === options.category);
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      result = result.filter(
        (r) => r.data.title.toLowerCase().includes(q) || r.data.slug.toLowerCase().includes(q)
      );
    }

    return result;
  } catch (err) {
    console.error('[CrockBites D1 Recipe] getAllRecipesFromDb error:', err);
    return [];
  }
}

export async function getRecipeBySlugFromDb(
  db: D1Database | null,
  slug: string
): Promise<FullRecipe | null> {
  if (!db || !slug) return null;

  const normalized = slug.trim().toLowerCase();

  try {
    const row = await db
      .prepare('SELECT * FROM recipes WHERE LOWER(slug) = ? LIMIT 1')
      .bind(normalized)
      .first<DbRecipeRow>();

    if (!row) return null;
    return rowToFullRecipe(row);
  } catch (err) {
    console.error(`[CrockBites D1 Recipe] getRecipeBySlugFromDb error for "${slug}":`, err);
    return null;
  }
}

export async function createRecipeInDb(
  db: D1Database | null,
  data: Partial<RecipeData> & { title: string; slug: string; description: string; category: string }
): Promise<FullRecipe> {
  if (!db) throw new Error('Database is not configured.');

  const slug = data.slug.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const pubDateIso = data.pubDate
    ? (data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10) : String(data.pubDate).slice(0, 10))
    : nowIso.slice(0, 10);
  const updatedDateIso = data.updatedDate
    ? (data.updatedDate instanceof Date ? data.updatedDate.toISOString().slice(0, 10) : String(data.updatedDate).slice(0, 10))
    : pubDateIso;

  const rowParams = [
    slug,
    data.title.trim(),
    data.seoTitle?.trim() || null,
    data.description.trim(),
    data.seoDescription?.trim() || null,
    data.category.trim(),
    JSON.stringify(Array.isArray(data.tags) ? data.tags : []),
    data.author?.trim() || 'CrockBites',
    data.image?.trim() || '/placeholder.svg',
    data.imageAlt?.trim() || data.title.trim(),
    JSON.stringify(Array.isArray(data.gallery) ? data.gallery : []),
    Number(data.prepMinutes || 0),
    Number(data.cookMinutes || 0),
    data.totalMinutes ? Number(data.totalMinutes) : null,
    data.cookTimeNote?.trim() || null,
    Number(data.servings || 4),
    data.servingsLabel?.trim() || 'servings',
    JSON.stringify(Array.isArray(data.ingredients) ? data.ingredients : []),
    JSON.stringify(Array.isArray(data.instructions) ? data.instructions : []),
    JSON.stringify(Array.isArray(data.servingSuggestions) ? data.servingSuggestions : []),
    JSON.stringify(Array.isArray(data.tips) ? data.tips : []),
    JSON.stringify(Array.isArray(data.substitutions) ? data.substitutions : []),
    JSON.stringify(data.storage && typeof data.storage === 'object' ? data.storage : {}),
    JSON.stringify(Array.isArray(data.equipment) ? data.equipment : []),
    JSON.stringify(Array.isArray(data.foodSafety) ? data.foodSafety : []),
    JSON.stringify(Array.isArray(data.dietaryLabels) ? data.dietaryLabels : []),
    data.dietaryVerified ? 1 : 0,
    JSON.stringify(Array.isArray(data.allergens) ? data.allergens : []),
    data.allergenReviewed ? 1 : 0,
    data.allergenNotes?.trim() || null,
    data.nutrition ? JSON.stringify(data.nutrition) : null,
    data.featured ? 1 : 0,
    data.popularRank ? Number(data.popularRank) : null,
    JSON.stringify(Array.isArray(data.related) ? data.related : []),
    data.notifyNewsletter !== false && data.sendNewsletter !== false ? 1 : 0,
    data.reviewStatus === 'tested' ? 'tested' : 'draft',
    typeof (data as any).body === 'string' ? (data as any).body : '',
    pubDateIso,
    updatedDateIso,
    nowIso,
    nowIso,
  ];

  await db
    .prepare(
      `INSERT INTO recipes (
        slug, title, seo_title, description, seo_description, category, tags, author,
        image_url, image_alt, gallery, prep_minutes, cook_minutes, total_minutes, cook_time_note,
        servings, servings_label, ingredients, instructions, serving_suggestions, tips, substitutions,
        storage, equipment, food_safety, dietary_labels, dietary_verified, allergens, allergen_reviewed,
        allergen_notes, nutrition, featured, popular_rank, related, notify_newsletter, review_status,
        body, pub_date, updated_date, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )`
    )
    .bind(...rowParams)
    .run();

  invalidateRecipeMemoryCache();

  const created = await getRecipeBySlugFromDb(db, slug);
  if (!created) throw new Error('Recipe was created but could not be retrieved from D1.');
  return created;
}

export async function updateRecipeInDb(
  db: D1Database | null,
  currentSlug: string,
  data: Partial<RecipeData> & { title?: string; slug?: string; description?: string; category?: string; body?: string }
): Promise<FullRecipe> {
  if (!db) throw new Error('Database is not configured.');

  const existing = await getRecipeBySlugFromDb(db, currentSlug);
  if (!existing) throw new Error(`Recipe with slug "${currentSlug}" does not exist in D1.`);

  const newSlug = (data.slug || currentSlug).trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const nowDay = nowIso.slice(0, 10);

  const prev = existing.data;
  const mergedTitle = data.title !== undefined ? data.title.trim() : prev.title;
  const mergedDescription = data.description !== undefined ? data.description.trim() : prev.description;
  const mergedCategory = data.category !== undefined ? data.category.trim() : prev.category;
  const mergedStatus = data.reviewStatus !== undefined ? (data.reviewStatus === 'tested' ? 'tested' : 'draft') : prev.reviewStatus;
  const mergedImage = data.image !== undefined ? data.image.trim() : prev.image;
  const mergedImageAlt = data.imageAlt !== undefined ? data.imageAlt.trim() : prev.imageAlt;
  const mergedBody = data.body !== undefined ? data.body : existing.body;

  const mergedPubDate = data.pubDate
    ? (data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10) : String(data.pubDate).slice(0, 10))
    : prev.pubDate.toISOString().slice(0, 10);

  const updateParams = [
    newSlug,
    mergedTitle,
    data.seoTitle !== undefined ? (data.seoTitle?.trim() || null) : (prev.seoTitle || null),
    mergedDescription,
    data.seoDescription !== undefined ? (data.seoDescription?.trim() || null) : (prev.seoDescription || null),
    mergedCategory,
    JSON.stringify(data.tags !== undefined ? data.tags : prev.tags),
    data.author !== undefined ? (data.author?.trim() || 'CrockBites') : prev.author,
    mergedImage,
    mergedImageAlt,
    JSON.stringify(data.gallery !== undefined ? data.gallery : prev.gallery),
    data.prepMinutes !== undefined ? Number(data.prepMinutes) : prev.prepMinutes,
    data.cookMinutes !== undefined ? Number(data.cookMinutes) : prev.cookMinutes,
    data.totalMinutes !== undefined ? (data.totalMinutes ? Number(data.totalMinutes) : null) : (prev.totalMinutes || null),
    data.cookTimeNote !== undefined ? (data.cookTimeNote?.trim() || null) : (prev.cookTimeNote || null),
    data.servings !== undefined ? Number(data.servings) : prev.servings,
    data.servingsLabel !== undefined ? (data.servingsLabel?.trim() || 'servings') : prev.servingsLabel,
    JSON.stringify(data.ingredients !== undefined ? data.ingredients : prev.ingredients),
    JSON.stringify(data.instructions !== undefined ? data.instructions : prev.instructions),
    JSON.stringify(data.servingSuggestions !== undefined ? data.servingSuggestions : prev.servingSuggestions),
    JSON.stringify(data.tips !== undefined ? data.tips : prev.tips),
    JSON.stringify(data.substitutions !== undefined ? data.substitutions : prev.substitutions),
    JSON.stringify(data.storage !== undefined ? data.storage : prev.storage),
    JSON.stringify(data.equipment !== undefined ? data.equipment : prev.equipment),
    JSON.stringify(data.foodSafety !== undefined ? data.foodSafety : prev.foodSafety),
    JSON.stringify(data.dietaryLabels !== undefined ? data.dietaryLabels : prev.dietaryLabels),
    data.dietaryVerified !== undefined ? (data.dietaryVerified ? 1 : 0) : (prev.dietaryVerified ? 1 : 0),
    JSON.stringify(data.allergens !== undefined ? data.allergens : prev.allergens),
    data.allergenReviewed !== undefined ? (data.allergenReviewed ? 1 : 0) : (prev.allergenReviewed ? 1 : 0),
    data.allergenNotes !== undefined ? (data.allergenNotes?.trim() || null) : (prev.allergenNotes || null),
    data.nutrition !== undefined ? (data.nutrition ? JSON.stringify(data.nutrition) : null) : (prev.nutrition ? JSON.stringify(prev.nutrition) : null),
    data.featured !== undefined ? (data.featured ? 1 : 0) : (prev.featured ? 1 : 0),
    data.popularRank !== undefined ? (data.popularRank ? Number(data.popularRank) : null) : (prev.popularRank || null),
    JSON.stringify(data.related !== undefined ? data.related : prev.related),
    data.notifyNewsletter !== undefined ? (data.notifyNewsletter ? 1 : 0) : (prev.notifyNewsletter ? 1 : 0),
    mergedStatus,
    mergedBody,
    mergedPubDate,
    nowDay,
    nowIso,
    currentSlug.toLowerCase(),
  ];

  await db
    .prepare(
      `UPDATE recipes SET
        slug = ?,
        title = ?,
        seo_title = ?,
        description = ?,
        seo_description = ?,
        category = ?,
        tags = ?,
        author = ?,
        image_url = ?,
        image_alt = ?,
        gallery = ?,
        prep_minutes = ?,
        cook_minutes = ?,
        total_minutes = ?,
        cook_time_note = ?,
        servings = ?,
        servings_label = ?,
        ingredients = ?,
        instructions = ?,
        serving_suggestions = ?,
        tips = ?,
        substitutions = ?,
        storage = ?,
        equipment = ?,
        food_safety = ?,
        dietary_labels = ?,
        dietary_verified = ?,
        allergens = ?,
        allergen_reviewed = ?,
        allergen_notes = ?,
        nutrition = ?,
        featured = ?,
        popular_rank = ?,
        related = ?,
        notify_newsletter = ?,
        review_status = ?,
        body = ?,
        pub_date = ?,
        updated_date = ?,
        updated_at = ?
      WHERE LOWER(slug) = ?`
    )
    .bind(...updateParams)
    .run();

  invalidateRecipeMemoryCache();

  const updated = await getRecipeBySlugFromDb(db, newSlug);
  if (!updated) throw new Error('Recipe was updated but could not be retrieved from D1.');
  return updated;
}

export async function deleteRecipeInDb(
  db: D1Database | null,
  slug: string
): Promise<boolean> {
  if (!db || !slug) return false;

  const normalized = slug.trim().toLowerCase();

  try {
    await db.prepare('DELETE FROM recipes WHERE LOWER(slug) = ?').bind(normalized).run();
    invalidateRecipeMemoryCache();
    return true;
  } catch (err) {
    console.error(`[CrockBites D1 Recipe] deleteRecipeInDb error for "${slug}":`, err);
    return false;
  }
}

export async function setRecipeStatusInDb(
  db: D1Database | null,
  slug: string,
  status: 'draft' | 'tested'
): Promise<boolean> {
  if (!db || !slug) return false;

  const normalized = slug.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const nowDay = nowIso.slice(0, 10);

  try {
    await db
      .prepare('UPDATE recipes SET review_status = ?, updated_date = ?, updated_at = ? WHERE LOWER(slug) = ?')
      .bind(status, nowDay, nowIso, normalized)
      .run();
    invalidateRecipeMemoryCache();
    return true;
  } catch (err) {
    console.error(`[CrockBites D1 Recipe] setRecipeStatusInDb error for "${slug}":`, err);
    return false;
  }
}
