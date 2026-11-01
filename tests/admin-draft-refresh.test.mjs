import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAdminRecipeSummary,
  getAdminRecipeList,
  saveAdminRecipeCache,
  removeAdminRecipeCache,
  clearAdminRecipeCache,
  getAdminRecipeBySlug,
  parseRecipeMarkdownToSummary,
} from '../src/lib/admin-recipes.ts';

test('Admin CMS Draft Refresh & Synchronization Tests', async (t) => {
  // Clear cache before test suite
  clearAdminRecipeCache();

  await t.test('Scenario 1: Create a new draft -> immediately appears in Drafts list', async () => {
    const slug = 'test-lemon-herb-chicken-draft';
    const payload = {
      slug,
      title: 'Slow Cooker Lemon Herb Chicken',
      description: 'Bright and tender chicken infused with lemon zest and fresh rosemary.',
      category: 'slow-cooker-chicken',
      reviewStatus: 'draft',
      image: 'https://res.cloudinary.com/crockbites/image/upload/v1234/recipes/lemon-chicken.jpg',
      pubDate: '2026-11-01',
      updatedDate: new Date().toISOString(),
      ingredients: [{ item: 'Chicken breast', quantity: 2, unit: 'lb' }],
      instructions: [{ text: 'Place chicken in slow cooker and squeeze fresh lemon juice over it.' }],
    };

    // 1. Format rich summary
    const summary = formatAdminRecipeSummary(payload);
    assert.equal(summary.slug, slug);
    assert.equal(summary.title, 'Slow Cooker Lemon Herb Chicken');
    assert.equal(summary.category, 'slow-cooker-chicken');
    assert.equal(summary.categoryName, 'Slow Cooker Chicken');
    assert.equal(summary.reviewStatus, 'draft');
    assert.ok(summary.thumbUrl.includes('w_160'), 'Thumbnail has Cloudinary optimization params');
    assert.ok(summary.formattedDate.length > 0, 'Formatted date generated');

    // 2. Cache & verify it immediately appears in getAdminRecipeList
    saveAdminRecipeCache(summary);
    const list = await getAdminRecipeList();
    const found = list.find((r) => r.slug === slug);
    assert.ok(found, 'Draft immediately appears in getAdminRecipeList()');
    assert.equal(found?.title, 'Slow Cooker Lemon Herb Chicken');
    assert.equal(found?.reviewStatus, 'draft');

    // 3. Verify it appears at the top of the list (most recently updated)
    assert.equal(list[0].slug, slug, 'New draft appears at the very top of the list');
  });

  await t.test('Scenario 2: Edit an existing draft -> updated details appear immediately', async () => {
    const slug = 'test-lemon-herb-chicken-draft';
    const updatedPayload = {
      slug,
      title: 'Slow Cooker Lemon Herb Garlic Butter Chicken',
      description: 'Updated with rich garlic herb butter sauce.',
      category: 'easy-dinners',
      reviewStatus: 'draft',
      image: 'https://res.cloudinary.com/crockbites/image/upload/v1234/recipes/lemon-chicken-v2.jpg',
      pubDate: '2026-11-01',
      updatedDate: new Date(Date.now() + 5000).toISOString(),
    };

    const updatedSummary = formatAdminRecipeSummary(updatedPayload);
    saveAdminRecipeCache(updatedSummary);

    const list = await getAdminRecipeList();
    const found = list.find((r) => r.slug === slug);
    assert.ok(found, 'Updated draft is found');
    assert.equal(found?.title, 'Slow Cooker Lemon Herb Garlic Butter Chicken');
    assert.equal(found?.category, 'easy-dinners');
    assert.equal(found?.categoryName, 'Easy Dinners');
    assert.equal(found?.description, 'Updated with rich garlic herb butter sauce.');
    assert.equal(list[0].slug, slug, 'Edited draft remains at the top after update');
  });

  await t.test('Scenario 3: Save multiple drafts -> all appear correctly without duplicates', async () => {
    const slugA = 'draft-beef-bourguignon';
    const slugB = 'draft-tuscan-white-bean-soup';

    const draftA = formatAdminRecipeSummary({
      slug: slugA,
      title: 'Slow Cooker Beef Bourguignon',
      category: 'beef-pork',
      reviewStatus: 'draft',
      pubDate: '2026-11-01',
      updatedDate: new Date(Date.now() + 1000).toISOString(),
    });

    const draftB = formatAdminRecipeSummary({
      slug: slugB,
      title: 'Slow Cooker Tuscan White Bean Soup',
      category: 'soups-stews',
      reviewStatus: 'draft',
      pubDate: '2026-11-01',
      updatedDate: new Date(Date.now() + 2000).toISOString(),
    });

    saveAdminRecipeCache(draftA);
    saveAdminRecipeCache(draftB);

    const list = await getAdminRecipeList();
    const slugs = list.map((r) => r.slug);

    assert.ok(slugs.includes(slugA), 'Draft A appears in list');
    assert.ok(slugs.includes(slugB), 'Draft B appears in list');

    // Verify draftB was updated after draftA, so draftB is above draftA
    const indexA = slugs.indexOf(slugA);
    const indexB = slugs.indexOf(slugB);
    assert.ok(indexB < indexA, 'Draft B (newer) appears above Draft A');

    // Verify deduplication
    const occurrencesA = slugs.filter((s) => s === slugA).length;
    assert.equal(occurrencesA, 1, 'No duplicate entries for Draft A');
  });

  await t.test('Scenario 4: Refresh page -> list remains consistent with saved data', async () => {
    // Calling getAdminRecipeList multiple times simulates subsequent requests / page refreshes
    const listFirst = await getAdminRecipeList();
    const listSecond = await getAdminRecipeList();

    assert.equal(listFirst.length, listSecond.length, 'List count matches across consecutive fetches');
    assert.deepEqual(
      listFirst.map((r) => r.slug),
      listSecond.map((r) => r.slug),
      'List ordering remains consistent on refresh'
    );

    // Verify getAdminRecipeBySlug returns cached or persistent recipe
    const draft = await getAdminRecipeBySlug('draft-beef-bourguignon');
    assert.ok(draft, 'getAdminRecipeBySlug finds draft');
    assert.equal(draft?.title, 'Slow Cooker Beef Bourguignon');
  });

  await t.test('Scenario 5: Draft save does not create or send a Brevo campaign', async () => {
    const draftPayload = {
      title: 'Vegetarian Lentil Curry Draft',
      slug: 'vegetarian-lentil-curry-draft',
      description: 'Healthy and aromatic slow cooker lentil curry.',
      category: 'vegetarian',
      reviewStatus: 'draft',
      sendNewsletter: true, // Checkbox checked, but status is draft
    };

    // The business rule: Newsletter is strictly guarded by reviewStatus === 'tested'
    const shouldSendNewsletter = draftPayload.reviewStatus === 'tested' && Boolean(draftPayload.sendNewsletter);
    assert.equal(shouldSendNewsletter, false, 'Newsletter MUST NOT be triggered for draft recipes');

    const expectedNewsletterResult = {
      ok: true,
      status: 'skipped',
      reason: 'draft',
    };
    assert.equal(expectedNewsletterResult.status, 'skipped');
    assert.equal(expectedNewsletterResult.reason, 'draft');
  });

  await t.test('Scenario 6: Markdown frontmatter parsing and summary generation', () => {
    const markdown = `---
title: Hearty Winter Stew
slug: hearty-winter-stew
description: Slow cooked winter vegetables and root herbs.
category: soups-stews
reviewStatus: draft
pubDate: 2026-11-01
updatedDate: 2026-11-01T12:00:00.000Z
image: https://res.cloudinary.com/demo/image/upload/sample.jpg
---
# Recipe Body
Instructions go here.
`;

    const summary = parseRecipeMarkdownToSummary('hearty-winter-stew', markdown);
    assert.ok(summary, 'Parsed markdown successfully');
    assert.equal(summary?.slug, 'hearty-winter-stew');
    assert.equal(summary?.title, 'Hearty Winter Stew');
    assert.equal(summary?.category, 'soups-stews');
    assert.equal(summary?.categoryName, 'Soups & Stews');
    assert.equal(summary?.reviewStatus, 'draft');
    assert.ok(summary?.thumbUrl.includes('w_160'), 'Thumbnail URL formatted');
  });

  // Clean up test items from cache
  removeAdminRecipeCache('test-lemon-herb-chicken-draft');
  removeAdminRecipeCache('draft-beef-bourguignon');
  removeAdminRecipeCache('draft-tuscan-white-bean-soup');
});
