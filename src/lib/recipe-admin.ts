import YAML from 'yaml';
import { sanitizeString, slugify } from './admin.ts';

export type RecipeImageItem = {
  url: string;
  publicId?: string;
  alt: string;
  width?: number;
  height?: number;
  isPrimary?: boolean;
};

export type FrontmatterRecipe = {
  title: string;
  slug?: string;
  description: string;
  category: string;
  tags: string[];
  image: string;
  imageAlt: string;
  gallery?: RecipeImageItem[];
  author: string;
  pubDate: string;
  updatedDate?: string;
  prepMinutes: number;
  cookMinutes: number;
  totalMinutes?: number;
  cookTimeNote?: string;
  servings: number;
  servingsLabel?: string;
  ingredients: Array<{
    quantity?: number;
    unit?: string;
    item: string;
    alt?: string;
    note?: string;
    group?: string;
    scale?: boolean;
    itemPlural?: string;
  }>;
  instructions: Array<{ title?: string; text: string }>;
  servingSuggestions?: string[];
  tips?: string[];
  substitutions?: Array<{ ingredient: string; swap: string }>;
  storage?: { fridge?: string; freezer?: string; reheating?: string };
  equipment?: string[];
  foodSafety?: string[];
  nutrition?: Record<string, unknown>;
  featured?: boolean;
  related?: string[];
  reviewStatus?: 'draft' | 'tested';
};

export const allowedCategories = [
  'slow-cooker-chicken',
  'beef-pork',
  'soups-stews',
  'easy-dinners',
  'breakfast',
  'vegetarian',
  'desserts-baking',
];

export function inferRecipeDraft(data: Partial<FrontmatterRecipe>) {
  const title = (data.title ?? '').trim();
  const description = (data.description ?? '').trim();
  const category = (data.category ?? '').trim();
  const image = (data.image ?? '').trim();
  const imageAlt = (data.imageAlt ?? '').trim();
  const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
  const instructions = Array.isArray(data.instructions) ? data.instructions : [];

  const issues: string[] = [];
  if (!title) issues.push('Title is required.');
  if (!description) issues.push('Description is required.');
  if (!allowedCategories.includes(category)) issues.push('Choose a valid recipe category.');
  if (!image) issues.push('Recipe image path is required.');
  if (!imageAlt) issues.push('Image alt text is required.');
  if (!data.pubDate) issues.push('Publication date is required.');
  if (!Number.isFinite(Number(data.prepMinutes))) issues.push('Preparation time is required.');
  if (!Number.isFinite(Number(data.cookMinutes))) issues.push('Cooking time is required.');
  if (!Number.isFinite(Number(data.servings)) || Number(data.servings) <= 0) issues.push('Servings must be greater than zero.');
  if (!ingredients.length) issues.push('At least one ingredient is required.');
  if (!instructions.length || instructions.some((item) => !String(item.text ?? '').trim())) {
    issues.push('All instructions require text.');
  }

  return { issues, slug: slugify(title || data.slug || 'recipe') };
}

export function normalizeRecipePayload(data: Partial<FrontmatterRecipe>): FrontmatterRecipe {
  const title = sanitizeRecipeString(data.title) || 'Untitled recipe';
  const slug = sanitizeRecipeString(data.slug) || slugify(title);
  const ingredientList = Array.isArray(data.ingredients) ? data.ingredients : [];
  const instructionList = Array.isArray(data.instructions) ? data.instructions : [];

  return {
    title,
    slug,
    description: sanitizeRecipeString(data.description) || 'A fresh CrockBites recipe.',
    category: data.category && allowedCategories.includes(data.category) ? data.category : 'easy-dinners',
    tags: Array.isArray(data.tags) ? data.tags.map((tag) => sanitizeRecipeString(tag)).filter(Boolean) : [],
    image: sanitizeRecipeString(data.image) || '../../assets/recipes/placeholder.svg',
    imageAlt: sanitizeRecipeString(data.imageAlt) || 'CrockBites recipe illustration',
    gallery: Array.isArray(data.gallery)
      ? data.gallery.map((img) => ({
          url: sanitizeRecipeString(img.url),
          publicId: img.publicId ? sanitizeRecipeString(img.publicId) : undefined,
          alt: sanitizeRecipeString(img.alt) || 'Recipe image',
          width: img.width ? Number(img.width) : undefined,
          height: img.height ? Number(img.height) : undefined,
          isPrimary: Boolean(img.isPrimary),
        })).filter((img) => Boolean(img.url))
      : [],
    author: sanitizeRecipeString(data.author) || 'CrockBites',
    pubDate: sanitizeRecipeString(data.pubDate) || new Date().toISOString().slice(0, 10),
    updatedDate: data.updatedDate ? sanitizeRecipeString(data.updatedDate) : undefined,
    prepMinutes: Number(data.prepMinutes ?? 0),
    cookMinutes: Number(data.cookMinutes ?? 0),
    totalMinutes: data.totalMinutes != null ? Number(data.totalMinutes) : undefined,
    cookTimeNote: data.cookTimeNote ? sanitizeRecipeString(data.cookTimeNote) : undefined,
    servings: Number(data.servings ?? 1),
    servingsLabel: sanitizeRecipeString(data.servingsLabel) || 'servings',
    ingredients: ingredientList.map((ingredient) => ({
      quantity: ingredient.quantity != null ? Number(ingredient.quantity) : undefined,
      unit: ingredient.unit ? sanitizeRecipeString(ingredient.unit) : undefined,
      item: sanitizeRecipeString(ingredient.item) || 'ingredient',
      alt: ingredient.alt ? sanitizeRecipeString(ingredient.alt) : undefined,
      note: ingredient.note ? sanitizeRecipeString(ingredient.note) : undefined,
      group: ingredient.group ? sanitizeRecipeString(ingredient.group) : undefined,
      scale: ingredient.scale ?? true,
      itemPlural: ingredient.itemPlural ? sanitizeRecipeString(ingredient.itemPlural) : undefined,
    })),
    instructions: instructionList.map((instruction) => ({
      title: instruction.title ? sanitizeRecipeString(instruction.title) : undefined,
      text: sanitizeRecipeString(instruction.text) || 'Add instructions.',
    })),
    servingSuggestions: Array.isArray(data.servingSuggestions) ? data.servingSuggestions.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    tips: Array.isArray(data.tips) ? data.tips.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    substitutions: Array.isArray(data.substitutions) ? data.substitutions.map((entry) => ({
      ingredient: sanitizeRecipeString(entry.ingredient),
      swap: sanitizeRecipeString(entry.swap),
    })).filter((entry) => entry.ingredient && entry.swap) : [],
    storage: data.storage ? {
      fridge: data.storage.fridge ? sanitizeRecipeString(data.storage.fridge) : undefined,
      freezer: data.storage.freezer ? sanitizeRecipeString(data.storage.freezer) : undefined,
      reheating: data.storage.reheating ? sanitizeRecipeString(data.storage.reheating) : undefined,
    } : {},
    equipment: Array.isArray(data.equipment) ? data.equipment.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    foodSafety: Array.isArray(data.foodSafety) ? data.foodSafety.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    nutrition: data.nutrition && typeof data.nutrition === 'object' ? data.nutrition : undefined,
    featured: Boolean(data.featured),
    related: Array.isArray(data.related) ? data.related.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    reviewStatus: data.reviewStatus === 'tested' ? 'tested' : 'draft',
  };
}

export function serializeRecipeToMarkdown(data: FrontmatterRecipe) {
  const normalized = normalizeRecipePayload(data);
  const frontmatter = {
    title: normalized.title,
    slug: normalized.slug,
    description: normalized.description,
    category: normalized.category,
    tags: normalized.tags,
    image: normalized.image,
    imageAlt: normalized.imageAlt,
    ...(normalized.gallery && normalized.gallery.length ? { gallery: normalized.gallery } : {}),
    author: normalized.author,
    pubDate: normalized.pubDate,
    ...(normalized.updatedDate ? { updatedDate: normalized.updatedDate } : {}),
    prepMinutes: Number(normalized.prepMinutes ?? 0),
    cookMinutes: Number(normalized.cookMinutes ?? 0),
    ...(normalized.totalMinutes != null ? { totalMinutes: Number(normalized.totalMinutes) } : {}),
    ...(normalized.cookTimeNote ? { cookTimeNote: normalized.cookTimeNote } : {}),
    servings: Number(normalized.servings ?? 1),
    ...(normalized.servingsLabel ? { servingsLabel: normalized.servingsLabel } : {}),
    ingredients: normalized.ingredients,
    instructions: normalized.instructions,
    ...(normalized.servingSuggestions?.length ? { servingSuggestions: normalized.servingSuggestions } : {}),
    ...(normalized.tips?.length ? { tips: normalized.tips } : {}),
    ...(normalized.substitutions?.length ? { substitutions: normalized.substitutions } : {}),
    ...(normalized.storage && Object.keys(normalized.storage).length ? { storage: normalized.storage } : {}),
    ...(normalized.equipment?.length ? { equipment: normalized.equipment } : {}),
    ...(normalized.foodSafety?.length ? { foodSafety: normalized.foodSafety } : {}),
    ...(normalized.nutrition ? { nutrition: normalized.nutrition } : {}),
    ...(normalized.featured !== undefined ? { featured: normalized.featured } : {}),
    ...(normalized.related?.length ? { related: normalized.related } : {}),
    reviewStatus: normalized.reviewStatus ?? 'draft',
  };

  return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 })}---\n\n${normalized.description}\n`;
}

export function sanitizeRecipeString(value: unknown) {
  return sanitizeString(value);
}
