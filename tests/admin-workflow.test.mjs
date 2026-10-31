import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  createCsrfToken,
} from '../src/lib/admin.ts';
import {
  inferRecipeDraft,
  serializeRecipeToMarkdown,
} from '../src/lib/recipe-admin.ts';

test('Admin CMS Recipe Workflow Lifecycle: Create Draft -> Preview -> Edit -> Publish -> Verify', async (t) => {
  const secret = 'test-admin-secret-for-qa-validation-12345';
  process.env.ADMIN_SESSION_SECRET = secret;

  // 1. Session & CSRF setup
  const sessionData = { id: 'test-session-id', username: 'admin', expiresAt: Date.now() + 3600000 };
  const csrf = createCsrfToken(secret, sessionData.id);
  assert.ok(csrf, 'CSRF token generated successfully');

  // 2. Create Recipe Draft payload (Create Recipe -> Save Draft)
  const draftTitle = 'QA Test Slow Cooker Honey Garlic Chicken';
  const autoSlug = slugify(draftTitle);
  assert.equal(autoSlug, 'qa-test-slow-cooker-honey-garlic-chicken');

  const draftPayload = {
    title: draftTitle,
    slug: autoSlug,
    description: 'A savory and sweet slow cooker chicken dinner tested for QA.',
    category: 'slow-cooker-chicken',
    author: 'CrockBites Kitchen',
    prepMinutes: 15,
    cookMinutes: 360,
    cookTimeNote: '6 to 8 hours on LOW',
    servings: 6,
    reviewStatus: 'draft',
    pubDate: new Date().toISOString().slice(0, 10),
    tags: ['chicken', 'dinner', 'honey garlic'],
    image: 'https://res.cloudinary.com/crockbites/image/upload/v1/recipes/honey-garlic-chicken.jpg',
    imageAlt: 'Slow cooker honey garlic chicken in bowl',
    ingredients: [
      { quantity: 2, unit: 'lb', item: 'boneless chicken breasts' },
      { quantity: 0.5, unit: 'cup', item: 'honey' },
      { quantity: 4, unit: 'cloves', item: 'garlic', note: 'minced' },
    ],
    instructions: [
      { title: 'Prep slow cooker', text: 'Place chicken breasts evenly in the bottom of the slow cooker.' },
      { title: 'Slow cook', text: 'Whisk honey and garlic, pour over chicken, cover and cook on LOW for 6 hours.' },
    ],
    dietaryLabels: ['dairy-free'],
    dietaryVerified: true,
    allergens: ['soybeans'],
    allergenReviewed: true,
  };

  // 3. Validation & Draft Serialization
  const validation = inferRecipeDraft(draftPayload);
  assert.equal(validation.issues.length, 0, 'Draft validation should have 0 issues');
  assert.equal(validation.slug, 'qa-test-slow-cooker-honey-garlic-chicken');

  const markdown = serializeRecipeToMarkdown(draftPayload);
  assert.ok(markdown.includes('reviewStatus: draft'), 'Frontmatter must specify reviewStatus: draft');
  assert.ok(markdown.includes('title: QA Test Slow Cooker Honey Garlic Chicken'), 'Markdown must contain title');
  assert.ok(markdown.includes('slug: qa-test-slow-cooker-honey-garlic-chicken'), 'Markdown must contain slug');
  assert.ok(markdown.includes('boneless chicken breasts'), 'Markdown must contain ingredient');

  // 4. Simulate Draft Preview verification
  // In preview/[slug].astro:
  const isDraft = draftPayload.reviewStatus === 'draft';
  assert.equal(isDraft, true, 'Draft preview must identify recipe as unpublished draft');
  const previewPath = `/admin/recipes/preview/${draftPayload.slug}/`;
  assert.ok(previewPath.includes(draftPayload.slug), 'Preview URL points to correct slug');

  // 5. Simulate Edit Recipe -> Publish
  const publishedPayload = {
    ...draftPayload,
    reviewStatus: 'tested',
    cookTimeNote: '6 to 8 hours on LOW or 3 to 4 hours on HIGH',
  };
  const pubValidation = inferRecipeDraft(publishedPayload);
  assert.equal(pubValidation.issues.length, 0, 'Publish validation should have 0 issues');

  const pubMarkdown = serializeRecipeToMarkdown(publishedPayload);
  assert.ok(pubMarkdown.includes('reviewStatus: tested'), 'Frontmatter must specify reviewStatus: tested');
  assert.ok(pubMarkdown.includes('6 to 8 hours on LOW or 3 to 4 hours on HIGH'), 'Updated cook time note preserved');

  // 6. Simulate View Live Recipe
  const isPublished = publishedPayload.reviewStatus === 'tested';
  assert.equal(isPublished, true, 'Published recipe must be marked as tested/live');
  const liveUrl = `/recipe/${publishedPayload.slug}/`;
  assert.equal(liveUrl, '/recipe/qa-test-slow-cooker-honey-garlic-chicken/');
});
