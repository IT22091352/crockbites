import assert from 'node:assert/strict';
import {
  inferRecipeDraft,
  mergeExistingRecipeWithUpdates,
  normalizeNutrition,
  normalizeRecipePayload,
  parseRecipeMarkdown,
  serializeRecipeToMarkdown,
} from '../src/lib/recipe-admin.ts';
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

// 10. Regression: Editing a recipe via Admin Editor preserves optional frontmatter fields & Markdown body
const richExistingMarkdown = `---
title: Classic Slow Cooker Beef Stew
slug: slow-cooker-beef-stew
description: Tender chuck roast simmered with carrots and potatoes.
category: soups-stews
tags:
  - beef
  - stew
image: https://res.cloudinary.com/demo/image/upload/stew.jpg
imageAlt: Bowl of beef stew
author: CrockBites
pubDate: 2026-02-14
prepMinutes: 20
cookMinutes: 480
totalMinutes: 500
cookTimeNote: 8 hours on LOW or 4 hours on HIGH
servings: 6
servingsLabel: generous bowls
ingredients:
  - quantity: 2
    unit: lb
    item: beef chuck roast
    note: cut into 1.5-inch cubes
    group: For the stew
    alt: (900 g)
instructions:
  - title: Sear the beef
    text: Brown the beef cubes in batches.
servingSuggestions:
  - Crusty sourdough bread
  - Steamed green beans
tips:
  - Cut carrots thicker than potatoes so they finish at the same time.
substitutions:
  - ingredient: Beef broth
    swap: Mushroom broth for a lighter base
storage:
  fridge: Up to 4 days in an airtight container.
  freezer: Freeze for up to 3 months.
  reheating: Reheat gently on the stovetop to 165°F (74°C).
equipment:
  - 6-quart slow cooker
foodSafety:
  - Cook beef to a minimum internal temperature of 160°F (71°C).
  - Reheat leftovers to 165°F (74°C).
featured: true
popularRank: 1
related:
  - slow-cooker-beef-chili
  - slow-cooker-pot-roast
reviewStatus: tested
---

This rich slow-cooker beef stew is a cold-weather staple that fills the kitchen with savory aroma all afternoon.
`;

// Simulate an edit-save where the admin form only sends core fields (updating title & servings)
const mergedAfterEdit = mergeExistingRecipeWithUpdates(richExistingMarkdown, {
  title: 'Classic Slow Cooker Beef Stew (Updated)',
  servings: 8,
});

const savedMarkdown = serializeRecipeToMarkdown(mergedAfterEdit);
const reparsed = parseRecipeMarkdown(savedMarkdown);

assert.equal(reparsed.frontmatter.title, 'Classic Slow Cooker Beef Stew (Updated)', 'updates modified title');
assert.equal(reparsed.frontmatter.servings, 8, 'updates modified servings');
assert.equal(reparsed.frontmatter.totalMinutes, 500, 'preserves totalMinutes');
assert.equal(reparsed.frontmatter.cookTimeNote, '8 hours on LOW or 4 hours on HIGH', 'preserves cookTimeNote');
assert.equal(reparsed.frontmatter.servingsLabel, 'generous bowls', 'preserves servingsLabel');
assert.deepEqual(reparsed.frontmatter.foodSafety, [
  'Cook beef to a minimum internal temperature of 160°F (71°C).',
  'Reheat leftovers to 165°F (74°C).',
], 'preserves foodSafety array');
assert.deepEqual(reparsed.frontmatter.equipment, ['6-quart slow cooker'], 'preserves equipment array');
assert.deepEqual(reparsed.frontmatter.tips, [
  'Cut carrots thicker than potatoes so they finish at the same time.',
], 'preserves tips array');
assert.deepEqual(reparsed.frontmatter.servingSuggestions, [
  'Crusty sourdough bread',
  'Steamed green beans',
], 'preserves servingSuggestions array');
assert.deepEqual(reparsed.frontmatter.substitutions, [
  { ingredient: 'Beef broth', swap: 'Mushroom broth for a lighter base' },
], 'preserves substitutions');
assert.deepEqual(reparsed.frontmatter.storage, {
  fridge: 'Up to 4 days in an airtight container.',
  freezer: 'Freeze for up to 3 months.',
  reheating: 'Reheat gently on the stovetop to 165°F (74°C).',
}, 'preserves storage instructions');
assert.equal(reparsed.frontmatter.featured, true, 'preserves featured flag');
assert.equal(reparsed.frontmatter.popularRank, 1, 'preserves popularRank');
assert.deepEqual(reparsed.frontmatter.related, [
  'slow-cooker-beef-chili',
  'slow-cooker-pot-roast',
], 'preserves related slugs');
assert.ok(
  reparsed.body.includes('This rich slow-cooker beef stew is a cold-weather staple'),
  'preserves Markdown body content after edit-save',
);

// 10. Test explicit field clearing (cookTimeNote, allergenNotes, nutrition) and ingredient metadata preservation
const markdownWithRichIngredientsAndNutrition = `---
title: Slow Cooker Chicken Curry
slug: slow-cooker-chicken-curry
description: Creamy slow cooker chicken curry.
category: slow-cooker-chicken
tags:
  - chicken
  - curry
image: ../../assets/recipes/chicken-curry.svg
imageAlt: Bowl of chicken curry
author: CrockBites
pubDate: "2026-01-15"
prepMinutes: 15
cookMinutes: 300
cookTimeNote: 5 hours on LOW
servings: 4
ingredients:
  - quantity: 2
    unit: lb
    item: boneless chicken thighs
    alt: (900 g)
    group: Main
    scale: true
  - quantity: 2
    item: bay leaf
    itemPlural: bay leaves
    group: Aromatics
    scale: false
instructions:
  - title: Slow cook
    text: Cook on LOW for 5 hours.
allergens:
  - milk
allergenReviewed: true
allergenNotes: Contains coconut milk and yogurt.
nutrition:
  calories: 420
  proteinGrams: 34
  source: USDA FoodData Central
reviewStatus: tested
---

Rich and aromatic slow cooker curry.
`;

// 10a. When ingredient list is updated with only core UI fields (quantity, unit, item, note), metadata (group, alt, scale, itemPlural) is preserved
const mergedPreservingIngMeta = mergeExistingRecipeWithUpdates(markdownWithRichIngredientsAndNutrition, {
  ingredients: [
    { quantity: 2.5, unit: 'lb', item: 'boneless chicken thighs', note: 'trimmed' },
    { quantity: 3, item: 'bay leaf' },
  ],
});
assert.equal(mergedPreservingIngMeta.ingredients[0].group, 'Main', 'preserves ingredient group');
assert.equal(mergedPreservingIngMeta.ingredients[0].alt, '(900 g)', 'preserves ingredient alt');
assert.equal(mergedPreservingIngMeta.ingredients[0].scale, true, 'preserves ingredient scale=true');
assert.equal(mergedPreservingIngMeta.ingredients[1].group, 'Aromatics', 'preserves second ingredient group');
assert.equal(mergedPreservingIngMeta.ingredients[1].itemPlural, 'bay leaves', 'preserves ingredient itemPlural');
assert.equal(mergedPreservingIngMeta.ingredients[1].scale, false, 'preserves ingredient scale=false');
assert.equal(mergedPreservingIngMeta.cookTimeNote, '5 hours on LOW', 'preserves omitted cookTimeNote');
assert.equal(mergedPreservingIngMeta.allergenNotes, 'Contains coconut milk and yogurt.', 'preserves omitted allergenNotes');
assert.equal(mergedPreservingIngMeta.nutrition?.calories, 420, 'preserves omitted nutrition');

// 10b. Explicitly clearing cookTimeNote (""), allergenNotes (""), and nutrition (undefined / null) removes old values
const mergedClearedOptional = mergeExistingRecipeWithUpdates(markdownWithRichIngredientsAndNutrition, {
  cookTimeNote: '',
  allergenNotes: '',
  nutrition: undefined,
});
assert.equal(mergedClearedOptional.cookTimeNote, undefined, 'explicitly clears cookTimeNote when empty string passed');
assert.equal(mergedClearedOptional.allergenNotes, undefined, 'explicitly clears allergenNotes when empty string passed');
assert.equal(mergedClearedOptional.nutrition, undefined, 'explicitly clears nutrition when key is present with undefined/null');

const clearedSerialized = serializeRecipeToMarkdown(mergedClearedOptional);
const clearedReparsed = parseRecipeMarkdown(clearedSerialized);
assert.equal(clearedReparsed.frontmatter.cookTimeNote, undefined, 'cleared cookTimeNote is omitted from serialized YAML');
assert.equal(clearedReparsed.frontmatter.allergenNotes, undefined, 'cleared allergenNotes is omitted from serialized YAML');
assert.equal(clearedReparsed.frontmatter.nutrition, undefined, 'cleared nutrition is omitted from serialized YAML');

console.log('recipe-and-cloudinary tests passed');

