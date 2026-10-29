import assert from 'node:assert/strict';
import { inferRecipeDraft, normalizeRecipePayload, serializeRecipeToMarkdown } from '../src/lib/recipe-admin.ts';
import { getOptimizedCloudinaryUrl, isCloudinaryConfigured } from '../src/lib/cloudinary.ts';
import { isRemoteImage } from '../src/utils/images.ts';

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

console.log('recipe-and-cloudinary tests passed');

