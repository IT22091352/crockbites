import assert from 'node:assert/strict';
import { inferRecipeDraft, normalizeRecipePayload, serializeRecipeToMarkdown } from '../src/lib/recipe-admin.ts';
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

console.log('recipe-and-cloudinary tests passed');

