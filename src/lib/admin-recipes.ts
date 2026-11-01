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

// In-memory cache for recipes created or updated in this runtime instance
const recentRecipesCache = new Map<string, { summary: AdminRecipeSummary; timestamp: number }>();
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

export function removeAdminRecipeCache(slug: string) {
  if (!slug) return;
  recentRecipesCache.delete(slug);
  lastGithubSync = 0;
}

export function clearAdminRecipeCache() {
  recentRecipesCache.clear();
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
 * Returns the unified recipe catalog for Admin CMS, merging:
 * 1. Astro built-in content collections (static / built)
 * 2. In-memory runtime cache of recent writes
 * 3. Newly committed GitHub recipes that haven't been rebuilt into the Astro bundle yet
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
    // Astro content virtual module not available in standalone tests, fallback to filesystem
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
    // Cache entries valid for 1 hour
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
        }
      }

      // Find files present in GitHub but missing from our recipeMap
      const missingOrNewer = ghFiles.filter((f) => {
        const filename = f.name || f.path.split('/').pop() || '';
        if (!filename.endsWith('.md')) return false;
        const slug = filename.replace(/\.md$/, '');
        return !recipeMap.has(slug);
      });

      // Fetch missing files from GitHub
      for (const file of missingOrNewer) {
        const filename = file.name || file.path.split('/').pop() || '';
        const slug = filename.replace(/\.md$/, '');
        try {
          const repoFile = await getRepoFile(file.path, config.branch || 'main');
          if (repoFile?.content) {
            const rawContent = Buffer.from(repoFile.content, 'base64').toString('utf8');
            const parsed = parseRecipeMarkdownToSummary(slug, rawContent);
            if (parsed) {
              recipeMap.set(slug, parsed);
              saveAdminRecipeCache(parsed);
            }
          }
        } catch (fetchErr) {
          console.warn(`[Admin Recipes] Failed to fetch missing recipe "${file.path}" from GitHub:`, fetchErr);
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
 * Finds a single recipe by slug, falling back to GitHub if missing from content collections.
 */
export async function getAdminRecipeBySlug(slug: string): Promise<AdminRecipeSummary | null> {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return null;

  // 1. Check in-memory cache
  const cached = recentRecipesCache.get(safeSlug);
  if (cached && Date.now() - cached.timestamp < 3600 * 1000) {
    return cached.summary;
  }

  // 2. Check local disk if available
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const localPath = path.resolve(process.cwd(), 'src/content/recipes', `${safeSlug}.md`);
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf8');
      const parsed = parseRecipeMarkdownToSummary(safeSlug, content);
      if (parsed) {
        saveAdminRecipeCache(parsed);
        return parsed;
      }
    }
  } catch {}

  // 3. Check Astro content collection
  try {
    const { getCollection } = await import('astro:content');
    const staticRecipes = await getCollection('recipes');
    const found = staticRecipes.find(
      (entry) =>
        entry.id.replace(/\.md$/, '') === safeSlug ||
        (entry.data.slug ?? '').toLowerCase() === safeSlug.toLowerCase()
    );
    if (found) {
      const summary = formatAdminRecipeSummary({
        slug: found.id.replace(/\.md$/, ''),
        title: found.data.title,
        description: found.data.description,
        category: found.data.category,
        reviewStatus: found.data.reviewStatus,
        image: found.data.image,
        pubDate: found.data.pubDate,
        updatedDate: found.data.updatedDate,
        ingredients: found.data.ingredients,
        instructions: found.data.instructions,
      });
      return summary;
    }
  } catch {}

  // 4. Fetch from GitHub directly
  const config = getGithubConfig();
  if (config.token && config.owner && config.repo) {
    try {
      const repoPath = repoRecipePath(safeSlug);
      const repoFile = await getRepoFile(repoPath, config.branch || 'main');
      if (repoFile?.content) {
        const rawContent = Buffer.from(repoFile.content, 'base64').toString('utf8');
        const parsed = parseRecipeMarkdownToSummary(safeSlug, rawContent);
        if (parsed) {
          saveAdminRecipeCache(parsed);
          return parsed;
        }
      }
    } catch {}
  }

  return null;
}
