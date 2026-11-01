import { getOptimizedCloudinaryUrl } from './cloudinary.ts';
import YAML from 'yaml';
import { getDb } from './db.ts';
import {
  getAllRecipesFromDb,
  getRecipeBySlugFromDb,
  formatRecipeSummary,
  invalidateRecipeMemoryCache,
  type FullRecipe,
} from './recipes-db.ts';

export const CATEGORY_MAP: Record<string, string> = {
  'slow-cooker-chicken': 'Slow Cooker Chicken',
  'beef-pork': 'Beef & Pork',
  'soups-stews': 'Soups & Stews',
  'easy-dinners': 'Easy Dinners',
  'breakfast': 'Breakfast',
  'vegetarian': 'Vegetarian',
  'desserts-baking': 'Desserts & Baking',
};

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

export interface FullAdminRecipe {
  id: string;
  slug: string;
  body: string;
  data: {
    title: string;
    slug?: string;
    description: string;
    category: string;
    tags: string[];
    image: string | any;
    imageAlt: string;
    gallery: any[];
    author: string;
    pubDate: Date;
    updatedDate?: Date;
    prepMinutes: number;
    cookMinutes: number;
    totalMinutes?: number;
    cookTimeNote?: string;
    servings: number;
    servingsLabel: string;
    ingredients: any[];
    instructions: any[];
    tips?: string[];
    foodSafety?: string[];
    equipment?: string[];
    servingSuggestions?: string[];
    substitutions?: any[];
    storage?: any;
    dietaryLabels: string[];
    dietaryVerified: boolean;
    allergens: string[];
    allergenReviewed: boolean;
    allergenNotes?: string;
    nutrition?: any;
    reviewStatus: 'draft' | 'tested';
    featured: boolean;
    [key: string]: any;
  };
}

// In-memory fallback caches
const recentRecipesCache = new Map<string, { summary: AdminRecipeSummary; timestamp: number }>();
const fullRecipeCache = new Map<string, { recipe: FullAdminRecipe; timestamp: number }>();

export function formatAdminRecipeSummary(raw: {
  slug: string;
  title: string;
  description?: string;
  category: string;
  reviewStatus?: string;
  image?: any;
  pubDate?: string | Date;
  updatedDate?: string | Date;
  ingredients?: any[];
  instructions?: any[];
}): AdminRecipeSummary {
  const slug = String(raw.slug || '').trim();
  const rawImage = raw.image;
  const imageUrl =
    typeof rawImage === 'string'
      ? rawImage
      : (rawImage as any)?.src || '/placeholder.svg';
  const isCloudinary = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
  const thumbUrl = isCloudinary ? getOptimizedCloudinaryUrl(imageUrl, 160) : imageUrl;

  const now = new Date();
  const pubDateObj = raw.pubDate
    ? raw.pubDate instanceof Date
      ? raw.pubDate
      : new Date(raw.pubDate)
    : now;
  const updatedDateObj = raw.updatedDate
    ? raw.updatedDate instanceof Date
      ? raw.updatedDate
      : new Date(raw.updatedDate)
    : pubDateObj;

  const formattedDate = !isNaN(updatedDateObj.getTime())
    ? updatedDateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

  const category = String(raw.category || 'easy-dinners');
  const categoryName = CATEGORY_MAP[category] || category;
  const reviewStatus = raw.reviewStatus === 'tested' ? 'tested' : 'draft';

  return {
    slug,
    title: String(raw.title || 'Untitled Recipe'),
    description: String(raw.description || ''),
    category,
    categoryName,
    reviewStatus,
    imageUrl,
    thumbUrl,
    formattedDate,
    updatedDate: isNaN(updatedDateObj.getTime()) ? now.toISOString() : updatedDateObj.toISOString(),
    pubDate: isNaN(pubDateObj.getTime()) ? now.toISOString().slice(0, 10) : pubDateObj.toISOString().slice(0, 10),
    ingredientsCount: Array.isArray(raw.ingredients) ? raw.ingredients.length : undefined,
    instructionsCount: Array.isArray(raw.instructions) ? raw.instructions.length : undefined,
  };
}

export function saveAdminRecipeCache(summary: AdminRecipeSummary) {
  if (!summary.slug) return;
  recentRecipesCache.set(summary.slug, {
    summary,
    timestamp: Date.now(),
  });
  invalidateRecipeMemoryCache();
}

export function saveAdminFullRecipeCache(slug: string, recipe: FullAdminRecipe) {
  if (!slug) return;
  fullRecipeCache.set(slug, {
    recipe,
    timestamp: Date.now(),
  });
  invalidateRecipeMemoryCache();
}

export function removeAdminRecipeCache(slug: string) {
  if (!slug) return;
  recentRecipesCache.delete(slug);
  fullRecipeCache.delete(slug);
  invalidateRecipeMemoryCache();
}

export function clearAdminRecipeCache() {
  recentRecipesCache.clear();
  fullRecipeCache.clear();
  invalidateRecipeMemoryCache();
}

/**
 * Parses a markdown file content into an AdminRecipeSummary
 */
export function parseRecipeMarkdownToSummary(slug: string, markdown: string): AdminRecipeSummary | null {
  try {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const data = YAML.parse(match[1]);
    if (!data || typeof data !== 'object') return null;

    return formatAdminRecipeSummary({
      slug: data.slug || slug,
      title: data.title,
      description: data.description,
      category: data.category,
      reviewStatus: data.reviewStatus,
      image: data.image,
      pubDate: data.pubDate,
      updatedDate: data.updatedDate,
      ingredients: data.ingredients,
      instructions: data.instructions,
    });
  } catch {
    return null;
  }
}

/**
 * Parses full markdown into a FullAdminRecipe object suitable for preview and edit views
 */
export function parseRecipeMarkdownToFull(slug: string, markdown: string): FullAdminRecipe | null {
  try {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const data = YAML.parse(match[1]);
    if (!data || typeof data !== 'object') return null;

    const rawBody = markdown.slice(match[0].length).trim();
    const finalSlug = data.slug || slug;

    const now = new Date();
    const pubDate = data.pubDate ? new Date(data.pubDate) : now;
    const updatedDate = data.updatedDate ? new Date(data.updatedDate) : undefined;

    return {
      id: `${finalSlug}.md`,
      slug: finalSlug,
      body: rawBody,
      data: {
        title: String(data.title || 'Untitled Recipe'),
        slug: finalSlug,
        description: String(data.description || ''),
        category: String(data.category || 'easy-dinners'),
        tags: Array.isArray(data.tags) ? data.tags : [],
        image: data.image || '/placeholder.svg',
        imageAlt: String(data.imageAlt || data.title || 'CrockBites recipe'),
        gallery: Array.isArray(data.gallery) ? data.gallery : [],
        author: String(data.author || 'CrockBites'),
        pubDate: isNaN(pubDate.getTime()) ? now : pubDate,
        updatedDate: updatedDate && !isNaN(updatedDate.getTime()) ? updatedDate : undefined,
        prepMinutes: Number(data.prepMinutes || 0),
        cookMinutes: Number(data.cookMinutes || 0),
        totalMinutes: data.totalMinutes ? Number(data.totalMinutes) : undefined,
        cookTimeNote: data.cookTimeNote ? String(data.cookTimeNote) : undefined,
        servings: Number(data.servings || 4),
        servingsLabel: String(data.servingsLabel || 'servings'),
        ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
        instructions: Array.isArray(data.instructions) ? data.instructions : [],
        tips: Array.isArray(data.tips) ? data.tips : [],
        foodSafety: Array.isArray(data.foodSafety) ? data.foodSafety : [],
        equipment: Array.isArray(data.equipment) ? data.equipment : [],
        servingSuggestions: Array.isArray(data.servingSuggestions) ? data.servingSuggestions : [],
        substitutions: Array.isArray(data.substitutions) ? data.substitutions : [],
        storage: data.storage && typeof data.storage === 'object' ? data.storage : {},
        dietaryLabels: Array.isArray(data.dietaryLabels) ? data.dietaryLabels : [],
        dietaryVerified: Boolean(data.dietaryVerified),
        allergens: Array.isArray(data.allergens) ? data.allergens : [],
        allergenReviewed: Boolean(data.allergenReviewed),
        allergenNotes: data.allergenNotes ? String(data.allergenNotes) : undefined,
        nutrition: data.nutrition,
        notifyNewsletter: data.notifyNewsletter !== undefined
          ? Boolean(data.notifyNewsletter)
          : (data.sendNewsletter !== undefined ? Boolean(data.sendNewsletter) : true),
        reviewStatus: data.reviewStatus === 'tested' ? 'tested' : 'draft',
        featured: Boolean(data.featured),
        related: Array.isArray(data.related) ? data.related : [],
      },
    };
  } catch {
    return null;
  }
}

/**
 * Returns the unified recipe catalog for Admin CMS.
 * Cloudflare D1 is the primary authoritative source of truth.
 */
export async function getAdminRecipeList(options: { fresh?: boolean } = {}): Promise<AdminRecipeSummary[]> {
  const recipeMap = new Map<string, AdminRecipeSummary>();

  // 1. Primary: Load from Cloudflare D1
  try {
    const db = await getDb();
    if (db) {
      const dbRecipes = await getAllRecipesFromDb(db, {
        includeDrafts: true,
        bypassCache: options.fresh,
      });
      for (const r of dbRecipes) {
        recipeMap.set(r.slug, formatRecipeSummary(r));
      }
    }
  } catch (err) {
    console.warn('[CrockBites Admin] D1 recipe fetch failed, checking fallbacks:', err);
  }

  // 2. Fallback: Astro content collection and local files if D1 had no recipes
  if (recipeMap.size === 0) {
    try {
      const { getCollection } = await import('astro:content');
      const staticRecipes = await getCollection('recipes');
      for (const entry of staticRecipes) {
        const slug = entry.id.replace(/\.md$/, '');
        const summary = formatAdminRecipeSummary({
          slug,
          title: entry.data.title,
          description: entry.data.description,
          category: entry.data.category,
          reviewStatus: entry.data.reviewStatus,
          image: entry.data.image,
          pubDate: entry.data.pubDate,
          updatedDate: entry.data.updatedDate,
          ingredients: entry.data.ingredients,
          instructions: entry.data.instructions,
        });
        recipeMap.set(slug, summary);
      }
    } catch {}

    // Local disk fallback for dev/testing
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const localDir = path.resolve(process.cwd(), 'src/content/recipes');
      if (fs.existsSync(localDir)) {
        const files = fs.readdirSync(localDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const slug = file.replace(/\.md$/, '');
            const filePath = path.join(localDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = parseRecipeMarkdownToSummary(slug, content);
            if (parsed) {
              recipeMap.set(slug, parsed);
            }
          }
        }
      }
    } catch {}
  }

  // 3. Merge in-memory runtime cache (recent writes / tests)
  for (const [slug, item] of recentRecipesCache.entries()) {
    if (Date.now() - item.timestamp < 3600 * 1000) {
      recipeMap.set(slug, item.summary);
    } else {
      recentRecipesCache.delete(slug);
    }
  }

  return Array.from(recipeMap.values()).sort(
    (a, b) => new Date(b.updatedDate || b.pubDate).getTime() - new Date(a.updatedDate || a.pubDate).getTime()
  );
}

/**
 * Retrieves a single recipe by its slug.
 * Prioritizes Cloudflare D1 as the single source of truth.
 */
export async function getAdminRecipeBySlug(slug: string): Promise<AdminRecipeSummary | null> {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return null;

  try {
    const db = await getDb();
    if (db) {
      const r = await getRecipeBySlugFromDb(db, safeSlug);
      if (r) return formatRecipeSummary(r);
    }
  } catch {}

  const cached = recentRecipesCache.get(safeSlug);
  if (cached && Date.now() - cached.timestamp < 3600 * 1000) {
    return cached.summary;
  }

  const list = await getAdminRecipeList();
  return list.find((r) => r.slug === safeSlug) ?? null;
}

/**
 * Returns the absolute latest full recipe data.
 * Cloudflare D1 is the primary authoritative source of truth.
 */
export async function getLatestAdminRecipe(
  slug: string,
  options: { fresh?: boolean; locals?: any; db?: any } = {}
): Promise<FullAdminRecipe | null> {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return null;

  // 1. Primary: Cloudflare D1
  try {
    const db = options.db || (await getDb(options.locals));
    if (db) {
      const r = await getRecipeBySlugFromDb(db, safeSlug);
      if (r) {
        return r as unknown as FullAdminRecipe;
      }
    }
  } catch (err) {
    console.warn(`[getLatestAdminRecipe] D1 lookup failed for ${safeSlug}:`, err);
  }

  // 2. In-memory cache fallback
  const cachedFull = fullRecipeCache.get(safeSlug);
  if (cachedFull && Date.now() - cachedFull.timestamp < 30 * 1000) {
    return cachedFull.recipe;
  }

  // 3. Local filesystem fallback
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const localPath = path.resolve(process.cwd(), 'src/content/recipes', `${safeSlug}.md`);
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf8');
      const parsed = parseRecipeMarkdownToFull(safeSlug, content);
      if (parsed) {
        saveAdminFullRecipeCache(safeSlug, parsed);
        return parsed;
      }
    }
  } catch {}

  // 4. Astro static content collection fallback
  try {
    const { getCollection } = await import('astro:content');
    const staticRecipes = await getCollection('recipes');
    const found = staticRecipes.find(
      (entry) =>
        entry.id.replace(/\.md$/, '') === safeSlug ||
        (entry.data.slug ?? '').toLowerCase() === safeSlug.toLowerCase()
    );
    if (found) {
      return {
        id: found.id,
        slug: found.id.replace(/\.md$/, ''),
        body: found.body || '',
        data: { ...found.data },
      } as FullAdminRecipe;
    }
  } catch {}

  return null;
}
