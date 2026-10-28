import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from '../config/site';
import { categories, categoryById, hubs, type Hub } from '../data/categories';

export type Recipe = CollectionEntry<'recipes'>;

export const recipeSlug = (r: Recipe) => r.data.slug ?? r.id;
export const recipeUrl = (r: Recipe | string) => `/recipe/${typeof r === 'string' ? r : recipeSlug(r)}/`;
export const categoryUrl = (slug: string) => `/category/${slug}/`;
export const absoluteUrl = (path: string) => new URL(path, site.url).href;

export async function getAllRecipes(): Promise<Recipe[]> {
  const all = await getCollection('recipes');
  const slugs = new Set<string>();
  for (const recipe of all) {
    const slug = recipeSlug(recipe);
    if (slugs.has(slug)) throw new Error(`Duplicate recipe slug "${slug}". Rename the slug or Markdown file.`);
    slugs.add(slug);
  }
  return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || a.data.title.localeCompare(b.data.title));
}

export const totalMinutes = (r: Recipe) => r.data.totalMinutes ?? r.data.prepMinutes + r.data.cookMinutes;

/** Draft recipes are visible on the site but kept out of search engines and the sitemap by default. */
export const isIndexable = (r: Recipe) => r.data.reviewStatus === 'tested' || site.indexDraftRecipes;

export function recipesForHub(all: Recipe[], hub: Hub): Recipe[] {
  return all.filter((r) =>
    (hub.tag && r.data.tags.map((t) => t.toLowerCase()).includes(hub.tag)) ||
    (hub.categories && hub.categories.includes(r.data.category)));
}

export const recipesForCategory = (all: Recipe[], id: string) => all.filter((r) => r.data.category === id);

export function relatedRecipes(all: Recipe[], recipe: Recipe, limit = 3): Recipe[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const chosen: Recipe[] = [];
  for (const id of recipe.data.related) { const r = byId.get(id); if (r && r.id !== recipe.id) chosen.push(r); }
  if (chosen.length < limit) {
    const rest = all.filter((r) => r.id !== recipe.id && !chosen.includes(r))
      .sort((a, b) => Number(b.data.category === recipe.data.category) - Number(a.data.category === recipe.data.category));
    chosen.push(...rest);
  }
  return chosen.slice(0, limit);
}

export function popularRecipes(all: Recipe[], limit = 4): Recipe[] {
  const ranked = all.filter((r) => r.data.popularRank).sort((a, b) => a.data.popularRank! - b.data.popularRank!);
  const rest = all.filter((r) => !r.data.popularRank);
  return [...ranked, ...rest].slice(0, limit);
}

/** Everything the category and hub routes need, one entry per URL slug. */
export function listingPages(all: Recipe[]) {
  const cats = categories.map((c) => ({ slug: c.id, name: c.name, description: c.description, recipes: recipesForCategory(all, c.id), kind: 'category' as const }));
  const hs = hubs.map((h) => ({ slug: h.slug, name: h.name, description: h.description, recipes: recipesForHub(all, h), kind: 'hub' as const }));
  return [...cats, ...hs];
}

export { categories, categoryById, hubs };
