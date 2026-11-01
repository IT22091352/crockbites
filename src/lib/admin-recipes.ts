import { getOptimizedCloudinaryUrl } from './cloudinary.ts';
import { getGithubConfig, getRepoFile, listRepoFiles, repoRecipePath } from './github.ts';
import YAML from 'yaml';

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

// In-memory caches for recipes created or updated in this runtime instance
const recentRecipesCache = new Map<string, { summary: AdminRecipeSummary; timestamp: number }>();
const fullRecipeCache = new Map<string, { recipe: FullAdminRecipe; timestamp: number }>();
const recipeShas = new Map<string, string>();
let lastGithubSync = 0;
const GITHUB_SYNC_TTL_MS = 20 * 1000; // 20 seconds cache

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
  const pubDateObj = raw.pubDate ? new Date(raw.pubDate) : now;
  const updatedDateObj = raw.updatedDate ? new Date(raw.updatedDate) : pubDateObj;
  const dateObj = !isNaN(updatedDateObj.getTime()) ? updatedDateObj : pubDateObj;

  const formattedDate = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString('en-US', {
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
  lastGithubSync = 0;
}

export function saveAdminFullRecipeCache(slug: string, recipe: FullAdminRecipe) {
  if (!slug) return;
  fullRecipeCache.set(slug, {
    recipe,
    timestamp: Date.now(),
  });
  lastGithubSync = 0;
}

export function removeAdminRecipeCache(slug: string) {
  if (!slug) return;
  recentRecipesCache.delete(slug);
  fullRecipeCache.delete(slug);
  recipeShas.delete(slug);
  lastGithubSync = 0;
}

export function clearAdminRecipeCache() {
  recentRecipesCache.clear();
  fullRecipeCache.clear();
  recipeShas.clear();
  lastGithubSync = 0;
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
 * Returns the unified recipe catalog for Admin CMS, merging:
 * 1. Astro built-in content collections (static / built)
 * 2. In-memory runtime cache of recent writes
 * 3. Newly committed or modified GitHub recipes
 */
export async function getAdminRecipeList(options: { fresh?: boolean } = {}): Promise<AdminRecipeSummary[]> {
  const recipeMap = new Map<string, AdminRecipeSummary>();

  // 1. Load from Astro content collection
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
  } catch {
    // Astro content virtual module not available in standalone tests
  }

  // 2. Check local disk for any markdown files if running in Node / local dev
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
  } catch {
    // Non-filesystem or read-only worker environment, skip
  }

  // 3. Merge in-memory runtime cache
  for (const [slug, item] of recentRecipesCache.entries()) {
    if (Date.now() - item.timestamp < 3600 * 1000) {
      recipeMap.set(slug, item.summary);
    } else {
      recentRecipesCache.delete(slug);
    }
  }

  // 4. Check GitHub if configured and cache expired or fresh requested
  const now = Date.now();
  const shouldSyncGithub = options.fresh || now - lastGithubSync > GITHUB_SYNC_TTL_MS;
  const config = getGithubConfig();

  if (shouldSyncGithub && config.token && config.owner && config.repo) {
    try {
      const ghFiles = await listRepoFiles('src/content/recipes', config.branch || 'main');
      lastGithubSync = now;

      // Purge any recipe that was removed from GitHub
      const ghSlugs = new Set(
        ghFiles
          .map((f) => (f.name || f.path.split('/').pop() || '').replace(/\.md$/, ''))
          .filter(Boolean)
      );
      for (const slug of recipeMap.keys()) {
        if (!ghSlugs.has(slug)) {
          recipeMap.delete(slug);
          recentRecipesCache.delete(slug);
          recipeShas.delete(slug);
        }
      }

      // Find files present in GitHub that are either:
      // a) Missing from recipeMap
      // b) Have a modified SHA compared to what we previously loaded
      const missingOrModified = ghFiles.filter((f) => {
        const filename = f.name || f.path.split('/').pop() || '';
        if (!filename.endsWith('.md')) return false;
        const slug = filename.replace(/\.md$/, '');
        const isMissing = !recipeMap.has(slug);
        const isModified = Boolean(f.sha && recipeShas.get(slug) && recipeShas.get(slug) !== f.sha);
        return isMissing || isModified;
      });

      // Fetch missing or modified files from GitHub
      for (const file of missingOrModified) {
        const filename = file.name || file.path.split('/').pop() || '';
        const slug = filename.replace(/\.md$/, '');
        try {
          const repoFile = await getRepoFile(file.path, config.branch || 'main');
          if (repoFile?.content) {
            const rawContent = Buffer.from(repoFile.content, 'base64').toString('utf8');
            const parsedSummary = parseRecipeMarkdownToSummary(slug, rawContent);
            const parsedFull = parseRecipeMarkdownToFull(slug, rawContent);
            if (parsedSummary) {
              recipeMap.set(slug, parsedSummary);
              saveAdminRecipeCache(parsedSummary);
              if (file.sha) recipeShas.set(slug, file.sha);
            }
            if (parsedFull) {
              saveAdminFullRecipeCache(slug, parsedFull);
            }
          }
        } catch (fetchErr) {
          console.warn(`[Admin Recipes] Failed to fetch updated recipe "${file.path}" from GitHub:`, fetchErr);
        }
      }
    } catch (ghErr) {
      console.warn('[Admin Recipes] GitHub sync skipped or failed:', ghErr);
    }
  }

  // Sort recipes: newest updated / created first
  const list = Array.from(recipeMap.values());
  list.sort((a, b) => {
    const aTime = new Date(a.updatedDate || a.pubDate).getTime();
    const bTime = new Date(b.updatedDate || b.pubDate).getTime();
    return bTime - aTime;
  });

  return list;
}

/**
 * Resolves the absolute latest recipe data for Admin Preview and Edit workflows.
 * Prioritizes GitHub and runtime cache over stale Astro build-time collection.
 */
export async function getLatestAdminRecipe(
  slug: string,
  options: { fresh?: boolean } = {}
): Promise<FullAdminRecipe | null> {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return null;

  // 1. Check in-memory cache unless fresh requested
  if (!options.fresh) {
    const cached = fullRecipeCache.get(safeSlug);
    if (cached && Date.now() - cached.timestamp < 30 * 1000) {
      return cached.recipe;
    }
  }

  // 2. Fetch from GitHub directly (the authoritative source of truth in production)
  const config = getGithubConfig();
  if (config.token && config.owner && config.repo) {
    try {
      const repoPath = repoRecipePath(safeSlug);
      const repoFile = await getRepoFile(repoPath, config.branch || 'main');
      if (repoFile?.content) {
        const rawContent = Buffer.from(repoFile.content, 'base64').toString('utf8');
        const parsed = parseRecipeMarkdownToFull(safeSlug, rawContent);
        if (parsed) {
          saveAdminFullRecipeCache(safeSlug, parsed);
          const summary = formatAdminRecipeSummary({
            ...parsed.data,
            slug: safeSlug,
          });
          saveAdminRecipeCache(summary);
          if (repoFile.sha) recipeShas.set(safeSlug, repoFile.sha);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[getLatestAdminRecipe] GitHub fetch failed for ${safeSlug}, checking fallbacks:`, err);
    }
  }

  // 3. Check local filesystem (for local dev and test environments)
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const localPath = path.resolve(process.cwd(), 'src/content/recipes', `${safeSlug}.md`);
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf8');
      const parsed = parseRecipeMarkdownToFull(safeSlug, content);
      if (parsed) {
        saveAdminFullRecipeCache(safeSlug, parsed);
        const summary = formatAdminRecipeSummary({
          ...parsed.data,
          slug: safeSlug,
        });
        saveAdminRecipeCache(summary);
        return parsed;
      }
    }
  } catch {}

  // 4. Fall back to Astro static content collection
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

  // 5. Fall back to recent in-memory summary if available
  const summaryCached = recentRecipesCache.get(safeSlug);
  if (summaryCached && Date.now() - summaryCached.timestamp < 30 * 1000) {
    const s = summaryCached.summary;
    return {
      id: `${s.slug}.md`,
      slug: s.slug,
      body: '',
      data: {
        title: s.title,
        slug: s.slug,
        description: s.description,
        category: s.category,
        tags: [],
        reviewStatus: s.reviewStatus,
        image: s.imageUrl,
        imageAlt: s.title,
        gallery: [],
        author: 'CrockBites',
        pubDate: new Date(s.pubDate),
        updatedDate: s.updatedDate ? new Date(s.updatedDate) : undefined,
        prepMinutes: 0,
        cookMinutes: 0,
        cookTimeNote: '',
        servings: 1,
        servingsLabel: 'servings',
        ingredients: [],
        instructions: [],
        tips: [],
        foodSafety: [],
        equipment: [],
        servingSuggestions: [],
        dietaryLabels: [],
        allergens: [],
        dietaryVerified: false,
        allergenReviewed: false,
        featured: false,
      } as unknown as FullAdminRecipe['data'],
    };
  }

  return null;
}

/**
 * Finds a single recipe summary by slug, prioritizing latest GitHub/cache data.
 */
export async function getAdminRecipeBySlug(slug: string): Promise<AdminRecipeSummary | null> {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return null;

  // Check recent summary cache first
  const cachedSummary = recentRecipesCache.get(safeSlug);
  if (cachedSummary && Date.now() - cachedSummary.timestamp < 30 * 1000) {
    return cachedSummary.summary;
  }

  const full = await getLatestAdminRecipe(safeSlug);
  if (!full) return null;

  return formatAdminRecipeSummary({
    ...full.data,
    slug: full.slug,
  });
}
