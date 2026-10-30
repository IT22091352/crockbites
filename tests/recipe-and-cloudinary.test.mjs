import assert from 'node:assert/strict';
import { inferRecipeDraft, normalizeNutrition, normalizeRecipePayload, serializeRecipeToMarkdown } from '../src/lib/recipe-admin.ts';
import {
  getOptimizedCloudinaryUrl,
  isCloudinaryConfigured,
  extractCloudinaryPublicId,
  findUnusedRecipeAssets,
  cleanupUnusedRecipeMedia,
} from '../src/lib/cloudinary.ts';
import { isRemoteImage } from '../src/utils/images.ts';
import { updateRecipeStatusInMarkdown } from '../src/pages/api/admin/recipes/bulk-status.ts';

// 1. Schema Validation & Draft Inference
const validDraft = inferRecipeDraft({
  title: 'Slow Cooker Honey Garlic Chicken',
  description: 'Tender chicken with sticky honey garlic glaze.',
  category: 'slow-cooker-chicken',
  image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  imageAlt: 'Honey garlic chicken',
  pubDate: '2026-10-29',
  prepMinutes: 10,
  cookMinutes: 240,
  servings: 4,
  ingredients: [{ item: 'Chicken breast', quantity: 2, unit: 'lb' }],
  instructions: [{ text: 'Cook on low for 4 hours.' }],
});
assert.equal(validDraft.issues.length, 0, 'valid draft has zero issues');
assert.equal(validDraft.slug, 'slow-cooker-honey-garlic-chicken', 'slug generated correctly');

const invalidDraft = inferRecipeDraft({
  title: '',
  servings: -1,
  ingredients: [],
});
assert.ok(invalidDraft.issues.length >= 3, 'catches missing fields');

// 2. Normalization & Markdown Serialization with Gallery
const normalized = normalizeRecipePayload({
  title: 'Honey Garlic Chicken',
  description: 'Delicious dish',
  category: 'slow-cooker-chicken',
  image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  imageAlt: 'Primary chicken image',
  gallery: [
    { url: 'https://res.cloudinary.com/demo/image/upload/step1.jpg', alt: 'Prep step', isPrimary: false },
    { url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', alt: 'Finished plate', isPrimary: true },
  ],
  prepMinutes: 10,
  cookMinutes: 240,
  servings: 4,
  ingredients: [{ item: 'Chicken', quantity: 2, unit: 'lb' }],
  instructions: [{ text: 'Cook low.' }],
});

assert.equal(normalized.gallery?.length, 2, 'gallery items preserved');
const markdown = serializeRecipeToMarkdown(normalized);
assert.ok(markdown.includes('gallery:'), 'markdown contains gallery frontmatter');
assert.ok(markdown.includes('step1.jpg'), 'markdown contains gallery url');

// 3. Cloudinary URL optimization
const rawCloudinaryUrl = 'https://res.cloudinary.com/demo/image/upload/v123456/sample.jpg';
const optimized = getOptimizedCloudinaryUrl(rawCloudinaryUrl, 800);
assert.ok(optimized.includes('f_auto,q_auto,w_800,c_limit'), 'adds automatic format, quality, and width transform');

// 4. Remote image detector
assert.equal(isRemoteImage('https://res.cloudinary.com/demo/image/upload/sample.jpg'), true);
assert.equal(isRemoteImage('../../assets/recipes/placeholder.svg'), false);

// 5. Cloudinary Public ID Extraction
const extracted1 = extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v123456/crockbites/recipes/chicken_curry.jpg');
assert.equal(extracted1, 'crockbites/recipes/chicken_curry', 'extracts public id from versioned url');

const extracted2 = extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_800/v98765/crockbites/recipes/step_1.webp');
assert.equal(extracted2, 'crockbites/recipes/step_1', 'extracts public id through transformations and version');

const extracted3 = extractCloudinaryPublicId('crockbites/recipes/standalone_id');
assert.equal(extracted3, 'crockbites/recipes/standalone_id', 'preserves raw public id');

// 6. Safe Orphan Media Detection
const targetRecipe = {
  image: 'https://res.cloudinary.com/demo/image/upload/v1/crockbites/recipes/shared_hero.jpg',
  gallery: [
    { url: 'https://res.cloudinary.com/demo/image/upload/v1/crockbites/recipes/unique_step.jpg' },
  ],
};

const otherRecipes = [
  {
    image: 'https://res.cloudinary.com/demo/image/upload/v1/crockbites/recipes/shared_hero.jpg',
    gallery: [],
  },
  {
    image: 'https://res.cloudinary.com/demo/image/upload/v1/crockbites/recipes/other_dish.jpg',
    gallery: [],
  },
];

const unusedAssets = findUnusedRecipeAssets(targetRecipe, otherRecipes);
assert.equal(unusedAssets.length, 1, 'only 1 unused asset identified');
assert.equal(unusedAssets[0], 'crockbites/recipes/unique_step', 'correctly identifies unique asset, protects shared asset');

// 7. Cleanup Workflow Error Handling (when credentials unconfigured)
const cleanupReport = await cleanupUnusedRecipeMedia(targetRecipe, otherRecipes);
assert.equal(cleanupReport.unusedCount, 1, 'reports 1 unused candidate');
assert.ok(cleanupReport.results.length > 0, 'generates cleanup result records');
if (!isCloudinaryConfigured()) {
  assert.equal(cleanupReport.results[0].status, 'failed', 'reports failure cleanly without throwing when unconfigured');
}

// 8. Bulk Recipe Status Frontmatter Transformation
const initialMarkdown = `---
title: Test Stew
reviewStatus: draft
category: soups-stews
---

## Instructions
Simmer on low.
`;

const updatedToTested = updateRecipeStatusInMarkdown(initialMarkdown, 'tested');
assert.ok(updatedToTested.includes('reviewStatus: tested'), 'updates reviewStatus to tested');
assert.ok(updatedToTested.includes('updatedDate:'), 'injects updatedDate');
assert.ok(updatedToTested.includes('Simmer on low.'), 'preserves markdown body content');

const updatedToDraft = updateRecipeStatusInMarkdown(updatedToTested, 'draft');
assert.ok(updatedToDraft.includes('reviewStatus: draft'), 'updates reviewStatus to draft');


// 9. Nutrition & Dietary Information Normalization and Serialization
const rawNutrition = {
  calories: 450,
  proteinGrams: 38.5,
  carbsGrams: 14.2,
  fatGrams: 18.0,
  saturatedFatGrams: 5.25,
  unsaturatedFatGrams: 10.5,
  fiberGrams: 3.4,
  sugarGrams: 4.1,
  sodiumMilligrams: 680,
  cholesterolMilligrams: 95,
  source: 'USDA FoodData Central #171057',
  verifiedDate: '2026-10-30',
  negativeFieldIgnored: -10,
};

const normalizedNutrition = normalizeNutrition(rawNutrition);
assert.ok(normalizedNutrition, 'normalized nutrition exists');
assert.equal(normalizedNutrition.calories, 450, 'calories preserved');
assert.equal(normalizedNutrition.proteinGrams, 38.5, 'protein preserved');
assert.equal(normalizedNutrition.saturatedFatGrams, 5.25, 'saturated fat preserved');
assert.equal(normalizedNutrition.unsaturatedFatGrams, 10.5, 'unsaturated fat preserved');
assert.equal(normalizedNutrition.source, 'USDA FoodData Central #171057', 'source preserved');
assert.equal(normalizedNutrition.verifiedDate, '2026-10-30', 'verifiedDate preserved');

// Ensure negative and empty values are omitted, not zeroed
const partialRaw = {
  calories: -50,
  proteinGrams: '',
  carbsGrams: 20,
  sodiumMilligrams: null,
};
const partialNormalized = normalizeNutrition(partialRaw);
assert.ok(partialNormalized, 'partial normalized exists');
assert.equal(partialNormalized.calories, undefined, 'negative calories rejected');
assert.equal(partialNormalized.carbsGrams, 20, 'valid carbs kept');
assert.equal(partialNormalized.proteinGrams, undefined, 'empty string omitted');
assert.equal(partialNormalized.sodiumMilligrams, undefined, 'null omitted, never zeroed');

// Ensure completely empty nutrition returns undefined
assert.equal(normalizeNutrition({}), undefined, 'empty object normalizes to undefined');
assert.equal(normalizeNutrition({ calories: '' }), undefined, 'empty values normalize to undefined');

// Round-trip markdown serialization with nutrition
const recipeWithNutrition = normalizeRecipePayload({
  title: 'Healthy Chicken Stew',
  description: 'Hearty nutrient-dense stew',
  category: 'soups-stews',
  image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  imageAlt: 'Chicken stew',
  prepMinutes: 15,
  cookMinutes: 360,
  servings: 6,
  ingredients: [{ item: 'Chicken', quantity: 2, unit: 'lb' }],
  instructions: [{ text: 'Cook slow.' }],
  nutrition: normalizedNutrition,
});

const serializedMd = serializeRecipeToMarkdown(recipeWithNutrition);
assert.ok(serializedMd.includes('nutrition:'), 'markdown includes nutrition header');
assert.ok(serializedMd.includes('calories: 450'), 'markdown includes calories');
assert.ok(serializedMd.includes('proteinGrams: 38.5'), 'markdown includes protein');
assert.ok(serializedMd.includes('saturatedFatGrams: 5.25'), 'markdown includes saturated fat');
assert.ok(serializedMd.includes('unsaturatedFatGrams: 10.5'), 'markdown includes unsaturated fat');
assert.ok(serializedMd.includes('USDA FoodData Central #171057'), 'markdown includes nutrition source');
assert.ok(!serializedMd.includes('undefined'), 'no undefined values in serialized markdown');

console.log('recipe-and-cloudinary tests passed');

