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

export type RecipeNutrition = {
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
  saturatedFatGrams?: number;
  unsaturatedFatGrams?: number;
  fiberGrams?: number;
  sugarGrams?: number;
  sodiumMilligrams?: number;
  cholesterolMilligrams?: number;
  source?: string;
  verifiedDate?: string;
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
  dietaryLabels?: DietaryLabel[];
  dietaryVerified?: boolean;
  allergens?: Allergen[];
  allergenReviewed?: boolean;
  allergenNotes?: string;
  nutrition?: RecipeNutrition;
  featured?: boolean;
  popularRank?: number;
  related?: string[];
  reviewStatus?: 'draft' | 'tested';
  body?: string;
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

export const allowedDietaryLabels = [
  'vegetarian',
  'vegan',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'low-carb',
  'keto-friendly',
  'high-protein',
  'low-sodium',
  'pescatarian',
] as const;

export type DietaryLabel = (typeof allowedDietaryLabels)[number];

export const allowedAllergens = [
  'milk',
  'eggs',
  'fish',
  'crustacean-shellfish',
  'tree-nuts',
  'peanuts',
  'wheat',
  'soybeans',
  'sesame',
] as const;

export type Allergen = (typeof allowedAllergens)[number];

export function normalizeDietaryLabels(val: unknown): DietaryLabel[] {
  if (!Array.isArray(val)) return [];
  const valid = new Set<string>(allowedDietaryLabels);
  return val
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is DietaryLabel => valid.has(item));
}

export function normalizeAllergens(val: unknown): Allergen[] {
  if (!Array.isArray(val)) return [];
  const valid = new Set<string>(allowedAllergens);
  return val
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is Allergen => valid.has(item));
}

export function normalizeNutrition(data: unknown): RecipeNutrition | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const raw = data as Record<string, unknown>;

  const parseNonNegative = (val: unknown): number | undefined => {
    if (val === '' || val == null) return undefined;
    const num = Number(val);
    return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : undefined;
  };

  const nutrition: RecipeNutrition = {};
  const cal = parseNonNegative(raw.calories);
  if (cal != null) nutrition.calories = cal;

  const protein = parseNonNegative(raw.proteinGrams);
  if (protein != null) nutrition.proteinGrams = protein;

  const carbs = parseNonNegative(raw.carbsGrams);
  if (carbs != null) nutrition.carbsGrams = carbs;

  const fat = parseNonNegative(raw.fatGrams);
  if (fat != null) nutrition.fatGrams = fat;

  const satFat = parseNonNegative(raw.saturatedFatGrams);
  if (satFat != null) nutrition.saturatedFatGrams = satFat;

  const unsatFat = parseNonNegative(raw.unsaturatedFatGrams);
  if (unsatFat != null) nutrition.unsaturatedFatGrams = unsatFat;

  const fiber = parseNonNegative(raw.fiberGrams);
  if (fiber != null) nutrition.fiberGrams = fiber;

  const sugar = parseNonNegative(raw.sugarGrams);
  if (sugar != null) nutrition.sugarGrams = sugar;

  const sodium = parseNonNegative(raw.sodiumMilligrams);
  if (sodium != null) nutrition.sodiumMilligrams = sodium;

  const cholesterol = parseNonNegative(raw.cholesterolMilligrams);
  if (cholesterol != null) nutrition.cholesterolMilligrams = cholesterol;

  if (typeof raw.source === 'string' && raw.source.trim()) {
    nutrition.source = raw.source.trim();
  }
  if (typeof raw.verifiedDate === 'string' && raw.verifiedDate.trim()) {
    nutrition.verifiedDate = raw.verifiedDate.trim();
  }

  return Object.keys(nutrition).length > 0 ? nutrition : undefined;
}

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

export function parseRecipeMarkdown(markdownContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = String(markdownContent ?? '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  try {
    const parsed = YAML.parse(match[1]);
    return {
      frontmatter: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {},
      body: (match[2] ?? '').trim(),
    };
  } catch {
    return { frontmatter: {}, body: (match[2] ?? '').trim() };
  }
}

export function mergeExistingRecipeWithUpdates(
  existingMarkdownOrData: string | Partial<FrontmatterRecipe>,
  updates: Partial<FrontmatterRecipe> & Record<string, unknown>,
): FrontmatterRecipe {
  let existingFm: Record<string, unknown> = {};
  let existingBody = '';

  if (typeof existingMarkdownOrData === 'string') {
    const parsed = parseRecipeMarkdown(existingMarkdownOrData);
    existingFm = parsed.frontmatter;
    existingBody = parsed.body;
  } else if (existingMarkdownOrData && typeof existingMarkdownOrData === 'object') {
    existingFm = { ...existingMarkdownOrData };
    if (typeof existingMarkdownOrData.body === 'string') {
      existingBody = existingMarkdownOrData.body;
    }
  }

  const pickOptional = <T>(key: string, updatedVal: T | undefined, fallbackVal: unknown): T | undefined => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (updatedVal === null || (typeof updatedVal === 'string' && updatedVal.trim() === '')) {
        return undefined;
      }
      return updatedVal;
    }
    return fallbackVal as T | undefined;
  };

  const mergedIngredients = (() => {
    if (updates.ingredients === undefined) {
      return existingFm.ingredients as FrontmatterRecipe['ingredients'];
    }
    const existingList = Array.isArray(existingFm.ingredients)
      ? (existingFm.ingredients as FrontmatterRecipe['ingredients'])
      : [];

    return updates.ingredients.map((incoming, idx) => {
      const normalizedItem = String(incoming.item ?? '').trim().toLowerCase();
      const matched =
        (existingList[idx] && String(existingList[idx].item ?? '').trim().toLowerCase() === normalizedItem
          ? existingList[idx]
          : existingList.find((ex) => String(ex.item ?? '').trim().toLowerCase() === normalizedItem)) ?? undefined;

      return {
        ...incoming,
        group: Object.prototype.hasOwnProperty.call(incoming, 'group') && incoming.group !== undefined
          ? (incoming.group || undefined)
          : matched?.group,
        alt: Object.prototype.hasOwnProperty.call(incoming, 'alt') && incoming.alt !== undefined
          ? (incoming.alt || undefined)
          : matched?.alt,
        scale: Object.prototype.hasOwnProperty.call(incoming, 'scale') && incoming.scale !== undefined
          ? incoming.scale
          : matched?.scale,
        itemPlural: Object.prototype.hasOwnProperty.call(incoming, 'itemPlural') && incoming.itemPlural !== undefined
          ? (incoming.itemPlural || undefined)
          : matched?.itemPlural,
      };
    });
  })();

  const mergedPubDate = (() => {
    const raw = updates.pubDate !== undefined ? updates.pubDate : existingFm.pubDate;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  })();

  const mergedUpdatedDate = (() => {
    const raw = updates.updatedDate !== undefined ? updates.updatedDate : existingFm.updatedDate;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 10);
    return undefined;
  })();

  const mergedRaw: Partial<FrontmatterRecipe> = {
    title: (updates.title ?? existingFm.title) as string,
    slug: (updates.slug ?? existingFm.slug) as string | undefined,
    description: (updates.description ?? existingFm.description) as string,
    category: (updates.category ?? existingFm.category) as string,
    tags: (updates.tags !== undefined ? updates.tags : existingFm.tags) as string[],
    image: (updates.image ?? existingFm.image) as string,
    imageAlt: (updates.imageAlt ?? existingFm.imageAlt) as string,
    gallery: pickOptional('gallery', updates.gallery, existingFm.gallery),
    author: (updates.author ?? existingFm.author) as string,
    pubDate: mergedPubDate,
    updatedDate: mergedUpdatedDate,
    prepMinutes: (updates.prepMinutes ?? existingFm.prepMinutes) as number,
    cookMinutes: (updates.cookMinutes ?? existingFm.cookMinutes) as number,
    totalMinutes: pickOptional('totalMinutes', updates.totalMinutes, existingFm.totalMinutes),
    cookTimeNote: pickOptional('cookTimeNote', updates.cookTimeNote, existingFm.cookTimeNote),
    servings: (updates.servings ?? existingFm.servings) as number,
    servingsLabel: pickOptional('servingsLabel', updates.servingsLabel, existingFm.servingsLabel),
    ingredients: mergedIngredients,
    instructions: (updates.instructions !== undefined ? updates.instructions : existingFm.instructions) as FrontmatterRecipe['instructions'],
    servingSuggestions: pickOptional('servingSuggestions', updates.servingSuggestions, existingFm.servingSuggestions),
    tips: pickOptional('tips', updates.tips, existingFm.tips),
    substitutions: pickOptional('substitutions', updates.substitutions, existingFm.substitutions),
    storage: pickOptional('storage', updates.storage, existingFm.storage),
    equipment: pickOptional('equipment', updates.equipment, existingFm.equipment),
    foodSafety: pickOptional('foodSafety', updates.foodSafety, existingFm.foodSafety),
    dietaryLabels: pickOptional('dietaryLabels', updates.dietaryLabels, existingFm.dietaryLabels),
    dietaryVerified: pickOptional('dietaryVerified', updates.dietaryVerified, existingFm.dietaryVerified),
    allergens: pickOptional('allergens', updates.allergens, existingFm.allergens),
    allergenReviewed: pickOptional('allergenReviewed', updates.allergenReviewed, existingFm.allergenReviewed),
    allergenNotes: pickOptional('allergenNotes', updates.allergenNotes, existingFm.allergenNotes),
    nutrition: Object.prototype.hasOwnProperty.call(updates, 'nutrition')
      ? (updates.nutrition ?? undefined)
      : (existingFm.nutrition as RecipeNutrition | undefined),
    featured: pickOptional('featured', updates.featured, existingFm.featured),
    popularRank: pickOptional('popularRank', updates.popularRank, existingFm.popularRank),
    related: pickOptional('related', updates.related, existingFm.related),
    reviewStatus: (updates.reviewStatus ?? existingFm.reviewStatus) as 'draft' | 'tested' | undefined,
    body: Object.prototype.hasOwnProperty.call(updates, 'body') && updates.body !== undefined
      ? String(updates.body)
      : existingBody,
  };

  return normalizeRecipePayload(mergedRaw);
}

export function normalizeRecipePayload(data: Partial<FrontmatterRecipe>): FrontmatterRecipe {
  const title = sanitizeRecipeString(data.title) || 'Untitled recipe';
  const slug = sanitizeRecipeString(data.slug) || slugify(title);
  const ingredientList = Array.isArray(data.ingredients) ? data.ingredients : [];
  const instructionList = Array.isArray(data.instructions) ? data.instructions : [];

  const popularRankNum = data.popularRank != null && data.popularRank !== ('' as unknown)
    ? Number(data.popularRank)
    : undefined;
  const popularRank = popularRankNum != null && Number.isFinite(popularRankNum) && popularRankNum > 0
    ? Math.round(popularRankNum)
    : undefined;

  const storageObj: { fridge?: string; freezer?: string; reheating?: string } = {};
  if (data.storage && typeof data.storage === 'object') {
    if (data.storage.fridge && sanitizeRecipeString(data.storage.fridge)) {
      storageObj.fridge = sanitizeRecipeString(data.storage.fridge);
    }
    if (data.storage.freezer && sanitizeRecipeString(data.storage.freezer)) {
      storageObj.freezer = sanitizeRecipeString(data.storage.freezer);
    }
    if (data.storage.reheating && sanitizeRecipeString(data.storage.reheating)) {
      storageObj.reheating = sanitizeRecipeString(data.storage.reheating);
    }
  }

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
    totalMinutes: data.totalMinutes != null && Number.isFinite(Number(data.totalMinutes)) ? Number(data.totalMinutes) : undefined,
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
    storage: storageObj,
    equipment: Array.isArray(data.equipment) ? data.equipment.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    foodSafety: Array.isArray(data.foodSafety) ? data.foodSafety.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    dietaryLabels: normalizeDietaryLabels(data.dietaryLabels),
    dietaryVerified: Boolean(data.dietaryVerified),
    allergens: normalizeAllergens(data.allergens),
    allergenReviewed: Boolean(data.allergenReviewed),
    allergenNotes: data.allergenNotes ? sanitizeRecipeString(data.allergenNotes) : undefined,
    nutrition: normalizeNutrition(data.nutrition),
    featured: Boolean(data.featured),
    popularRank,
    related: Array.isArray(data.related) ? data.related.map((item) => sanitizeRecipeString(item)).filter(Boolean) : [],
    reviewStatus: data.reviewStatus === 'tested' ? 'tested' : 'draft',
    body: typeof data.body === 'string' ? data.body.trim() : undefined,
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
    ...(normalized.dietaryLabels && normalized.dietaryLabels.length ? {
      dietaryLabels: normalized.dietaryLabels,
      dietaryVerified: Boolean(normalized.dietaryVerified),
    } : (normalized.dietaryVerified ? { dietaryVerified: true } : {})),
    ...(normalized.allergens && normalized.allergens.length ? {
      allergens: normalized.allergens,
    } : {}),
    ...(normalized.allergenReviewed ? { allergenReviewed: true } : {}),
    ...(normalized.allergenNotes ? { allergenNotes: normalized.allergenNotes } : {}),
    ...(normalized.nutrition ? { nutrition: normalized.nutrition } : {}),
    ...(normalized.featured !== undefined ? { featured: normalized.featured } : {}),
    ...(normalized.popularRank != null ? { popularRank: normalized.popularRank } : {}),
    ...(normalized.related?.length ? { related: normalized.related } : {}),
    reviewStatus: normalized.reviewStatus ?? 'draft',
  };

  const bodyText = typeof normalized.body === 'string' ? normalized.body.trim() : '';
  if (bodyText && bodyText !== normalized.description.trim()) {
    return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 })}---\n\n${bodyText}\n`;
  }

  return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 })}---\n`;
}

export function sanitizeRecipeString(value: unknown) {
  return sanitizeString(value);
}
