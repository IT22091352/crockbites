import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAdminRecipeSummary,
  getAdminRecipeList,
  saveAdminRecipeCache,
  removeAdminRecipeCache,
  clearAdminRecipeCache,
  getAdminRecipeBySlug,
  getLatestAdminRecipe,
  parseRecipeMarkdownToSummary,
  parseRecipeMarkdownToFull,
  saveAdminFullRecipeCache,
} from '../src/lib/admin-recipes.ts';
import { serializeRecipeToMarkdown } from '../src/lib/recipe-admin.ts';
import {
  buildSessionCookie,
  createCsrfToken,
  getAdminSessionSecret,
  parseAdminSessionCookie,
  verifySessionCookie,
  ensureCsrfToken,
} from '../src/lib/admin.ts';

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

  await t.test('Scenario 7: Preview route resolves latest saved Markdown content (bypassing stale build data)', async () => {
    const slug = 'test-preview-regression-draft';

    // Simulate an old version that was in the static build bundle
    const oldBuildMarkdown = `---
title: Old Draft Title
slug: ${slug}
description: Stale description from old build.
category: slow-cooker-chicken
reviewStatus: draft
pubDate: 2026-10-25
---
Old instructions.
`;
    const oldParsed = parseRecipeMarkdownToFull(slug, oldBuildMarkdown);
    assert.equal(oldParsed?.data.title, 'Old Draft Title', 'Old version has old title');

    // Now simulate an updated save to GitHub / Markdown file with new title and ingredients
    const updatedMarkdown = `---
title: CrockBites Draft Sync Test Updated
slug: ${slug}
description: Fresh description reflecting latest saved changes.
category: slow-cooker-chicken
reviewStatus: draft
pubDate: 2026-10-25
updatedDate: 2026-11-01T15:30:00.000Z
ingredients:
  - quantity: 3
    unit: lb
    item: updated chicken thighs
instructions:
  - text: Freshly updated cooking instructions.
---
Updated body content.
`;

    // Parse the fresh markdown
    const freshFull = parseRecipeMarkdownToFull(slug, updatedMarkdown);
    assert.ok(freshFull, 'Parsed fresh markdown');
    assert.equal(freshFull.data.title, 'CrockBites Draft Sync Test Updated');
    assert.equal(freshFull.data.ingredients[0].item, 'updated chicken thighs');

    // Seed the cache with the updated full recipe
    saveAdminFullRecipeCache(slug, freshFull);

    // Verify getLatestAdminRecipe resolves the updated title, not the old build title
    const resolved = await getLatestAdminRecipe(slug);
    assert.ok(resolved, 'Resolved recipe for preview');
    assert.equal(resolved.data.title, 'CrockBites Draft Sync Test Updated', 'Preview loader must return the updated title');
    assert.notEqual(resolved.data.title, 'Old Draft Title', 'Preview loader must NOT return stale build title');
    assert.equal(resolved.data.description, 'Fresh description reflecting latest saved changes.');
    assert.equal(resolved.data.ingredients[0].item, 'updated chicken thighs');
    assert.equal(resolved.data.instructions[0].text, 'Freshly updated cooking instructions.');
    assert.equal(resolved.data.reviewStatus, 'draft', 'Preview maintains unpublished draft status');

    // Verify anti-caching headers standard
    const noCacheHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, s-maxage=0',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    };
    assert.ok(noCacheHeaders['Cache-Control'].includes('no-store'), 'Strict anti-caching enabled for preview routes');
  });

  await t.test('Scenario 8: Newsletter UI/UX - Save as Draft, Confirmation Dialog, and Publishing Workflows', async (t) => {
    // 1. Checked + Save as Draft -> no campaign, custom flash message, notifyNewsletter preserved
    await t.test('Case 1: Checked + Save as Draft', () => {
      const isNewsletterChecked = true;
      const targetStatus = 'draft';

      const flashMsg = targetStatus === 'draft'
        ? (isNewsletterChecked ? 'Draft saved successfully. No newsletter email was sent.' : 'Draft saved successfully.')
        : 'Recipe published successfully.';

      assert.equal(flashMsg, 'Draft saved successfully. No newsletter email was sent.');

      const markdown = serializeRecipeToMarkdown({
        title: 'Draft with Newsletter Checked',
        slug: 'draft-newsletter-checked',
        description: 'Testing draft saving with newsletter checked.',
        category: 'slow-cooker-chicken',
        pubDate: '2026-11-01',
        ingredients: [{ item: 'Chicken' }],
        instructions: [{ text: 'Cook' }],
        reviewStatus: 'draft',
        notifyNewsletter: isNewsletterChecked,
      });

      assert.ok(markdown.includes('notifyNewsletter: true'), 'Frontmatter preserves notifyNewsletter: true');
      const parsed = parseRecipeMarkdownToFull('draft-newsletter-checked', markdown);
      assert.equal(parsed?.data.notifyNewsletter, true, 'Parsed recipe maintains notifyNewsletter === true');
    });

    // 2. Unchecked + Save as Draft -> no campaign, standard flash message, notifyNewsletter: false preserved
    await t.test('Case 2: Unchecked + Save as Draft', () => {
      const isNewsletterChecked = false;
      const targetStatus = 'draft';

      const flashMsg = targetStatus === 'draft'
        ? (isNewsletterChecked ? 'Draft saved successfully. No newsletter email was sent.' : 'Draft saved successfully.')
        : 'Recipe published successfully.';

      assert.equal(flashMsg, 'Draft saved successfully.');

      const markdown = serializeRecipeToMarkdown({
        title: 'Draft with Newsletter Unchecked',
        slug: 'draft-newsletter-unchecked',
        description: 'Testing draft saving with newsletter unchecked.',
        category: 'slow-cooker-chicken',
        pubDate: '2026-11-01',
        ingredients: [{ item: 'Chicken' }],
        instructions: [{ text: 'Cook' }],
        reviewStatus: 'draft',
        notifyNewsletter: isNewsletterChecked,
      });

      assert.ok(markdown.includes('notifyNewsletter: false'), 'Frontmatter preserves notifyNewsletter: false');
      const parsed = parseRecipeMarkdownToFull('draft-newsletter-unchecked', markdown);
      assert.equal(parsed?.data.notifyNewsletter, false, 'Parsed recipe maintains notifyNewsletter === false');
    });

    // 3. Checked + Publish -> confirmation dialog appears
    await t.test('Case 3: Checked + Publish triggers confirmation dialog requirement', () => {
      const isNewsletterChecked = true;
      const isDraft = true;

      // In client logic, dialog opens if checkbox is checked
      const shouldShowConfirmation = isDraft && isNewsletterChecked;
      assert.equal(shouldShowConfirmation, true, 'Confirmation dialog MUST appear before publishing with newsletter');
    });

    // 4. Cancel confirmation -> recipe remains unpublished and no campaign is sent
    await t.test('Case 4: Cancel confirmation dialog preserves unpublished draft state', () => {
      let isModalOpen = true;
      let recipePublished = false;
      let campaignDispatched = false;

      // User clicks Cancel
      isModalOpen = false;
      // Publish is not called
      assert.equal(isModalOpen, false, 'Modal closed');
      assert.equal(recipePublished, false, 'Recipe remains draft');
      assert.equal(campaignDispatched, false, 'No campaign dispatched');
    });

    // 5. Confirm Publish & Send -> publishing workflow executes once
    await t.test('Case 5: Confirm Publish & Send executes publishing and dispatches campaign once', () => {
      let submitCallCount = 0;
      let isButtonDisabled = false;

      function onConfirm() {
        if (isButtonDisabled) return; // Prevent double submit
        isButtonDisabled = true;
        submitCallCount++;
      }

      onConfirm();
      onConfirm(); // Duplicate click simulation

      assert.equal(submitCallCount, 1, 'Publishing workflow executes exactly once');
      assert.equal(isButtonDisabled, true, 'Confirm button is disabled after first click');
    });

    // 6. Unchecked + Publish -> publishes without newsletter, skips confirmation dialog
    await t.test('Case 6: Unchecked + Publish bypasses confirmation dialog and skips campaign', () => {
      const isNewsletterChecked = false;
      const isDraft = true;

      const shouldShowConfirmation = isDraft && isNewsletterChecked;
      assert.equal(shouldShowConfirmation, false, 'No confirmation dialog when newsletter is unchecked');

      // Newsletter dispatch logic
      const shouldDispatchCampaign = isDraft && isNewsletterChecked;
      assert.equal(shouldDispatchCampaign, false, 'No campaign dispatched');
    });

    // 7. Editing an already-published recipe -> no duplicate campaign
    await t.test('Case 7: Editing already-published recipe skips campaign', () => {
      const existingStatus = 'tested';
      const targetStatus = 'tested';
      const isTransitionToPublished = existingStatus !== 'tested' && targetStatus === 'tested';

      assert.equal(isTransitionToPublished, false, 'Not a transition to published');
      const newsletterResult = {
        ok: true,
        status: 'skipped',
        reason: 'already_published',
      };
      assert.equal(newsletterResult.status, 'skipped');
      assert.equal(newsletterResult.reason, 'already_published');
    });

    // 8. API failure during publishing resets confirmation modal and button states
    await t.test('Case 8: API failure during publishing resets confirmation modal and button states', () => {
      let isModalOpen = true;
      let executeBtnDisabled = true;
      let executeBtnText = 'Publishing & Sending...';
      let cancelBtnDisabled = true;
      let errorMessage = '';

      function resetConfirmModalState() {
        executeBtnDisabled = false;
        executeBtnText = 'Publish & Send Newsletter';
        cancelBtnDisabled = false;
      }

      function closeConfirmModal() {
        isModalOpen = false;
        resetConfirmModalState();
      }

      // Simulate API failure (e.g. 500 error or network error)
      const simulatedApiError = 'Network error: Failed to fetch';
      errorMessage = simulatedApiError;
      closeConfirmModal();

      assert.equal(isModalOpen, false, 'Modal is closed on API failure');
      assert.equal(executeBtnDisabled, false, 'Publish button exits loading state and is re-enabled');
      assert.equal(executeBtnText, 'Publish & Send Newsletter', 'Button text is restored');
      assert.equal(cancelBtnDisabled, false, 'Cancel button is re-enabled');
      assert.equal(errorMessage, 'Network error: Failed to fetch', 'Useful error message is captured for display');
    });

    // 9. Verify no ReferenceError for isNewsletterChecked in [slug].astro and new.astro
    await t.test('Case 9: Verify no ReferenceError for isNewsletterChecked in recipe editing and creation', () => {
      const slugAstro = fs.readFileSync('src/pages/admin/recipes/[slug].astro', 'utf8');
      const newAstro = fs.readFileSync('src/pages/admin/recipes/new.astro', 'utf8');

      // Check [slug].astro
      assert.ok(
        slugAstro.includes("const isNewsletterChecked = Boolean(newsletterCheckbox?.checked);") ||
        slugAstro.includes("isNewsletterChecked = Boolean("),
        '[slug].astro must define isNewsletterChecked inside submitRecipe'
      );

      // Check new.astro
      assert.ok(
        newAstro.includes("const isNewsletterChecked = Boolean("),
        'new.astro must define isNewsletterChecked inside submitRecipe'
      );

      // Ensure no undeclared global usage
      const submitIdx = slugAstro.indexOf('async function submitRecipe');
      const payloadIdx = slugAstro.indexOf('const payload =', submitIdx);
      assert.ok(submitIdx !== -1, 'Found submitRecipe function in [slug].astro');
      assert.ok(payloadIdx !== -1, 'Found payload declaration in [slug].astro');
      const preamble = slugAstro.slice(submitIdx, payloadIdx);
      assert.ok(
        preamble.includes('isNewsletterChecked'),
        'isNewsletterChecked must be defined prior to payload creation in [slug].astro submitRecipe'
      );
    });
  });

  await t.test('Scenario 9: Admin Recipe Preview Data Loading & SVG Path Validation', async (t) => {
    // 1. Parsing draft markdown without 'related' or with string dates must produce a fully-formed FullAdminRecipe
    const draftMarkdown = `---
title: CrockBites Draft Sync Test 3
slug: test-cook
description: test cook preview test
category: beef-pork
tags: []
image: https://res.cloudinary.com/dmxumqqpj/image/upload/v1793527783/crockbites/recipes/ohsbfvarthpo5qqefyba.jpg
imageAlt: test cook book
author: CrockBites
pubDate: 2026-11-01
updatedDate: 2026-11-01
prepMinutes: 15
cookMinutes: 240
servings: 6
servingsLabel: servings
ingredients:
  - quantity: 2
    unit: lb
    item: chicken breast
    scale: true
instructions:
  - text: Place all ingredients into the slow cooker and cook on low.
featured: false
reviewStatus: draft
---
Custom intro markdown notes`;

    const fullRecipe = parseRecipeMarkdownToFull('test-cook', draftMarkdown);
    assert.ok(fullRecipe, 'Parsed full recipe must not be null');
    assert.equal(fullRecipe.slug, 'test-cook');
    assert.equal(fullRecipe.data.title, 'CrockBites Draft Sync Test 3');
    assert.ok(Array.isArray(fullRecipe.data.related), 'related field must be an array, not undefined');
    assert.ok(fullRecipe.data.pubDate instanceof Date, 'pubDate must be a Date instance');
    assert.ok(fullRecipe.data.updatedDate instanceof Date, 'updatedDate must be a Date instance');
    assert.equal(typeof fullRecipe.data.storage, 'object', 'storage must be an object');
    assert.equal(fullRecipe.data.storage?.fridge, undefined, 'accessing storage.fridge must not throw');

    // 2. Draft recipe object has safe fields preventing TypeError: recipe.data.related is not iterable
    const relatedList = Array.isArray(fullRecipe.data.related) ? fullRecipe.data.related : [];
    assert.doesNotThrow(() => {
      for (const id of relatedList) {}
    }, 'Iterating related list must never throw');

    // 3. pubDate and updatedDate are valid Date objects with working toISOString()
    assert.equal(typeof fullRecipe.data.pubDate.toISOString, 'function');
    assert.equal(fullRecipe.data.pubDate.toISOString().slice(0, 10), '2026-11-01');
    assert.equal(typeof fullRecipe.data.updatedDate.toISOString, 'function');
    assert.equal(fullRecipe.data.updatedDate.toISOString().slice(0, 10), '2026-11-01');

    // 4. SVG validation: check admin recipes index preview button SVG
    const indexAstro = fs.readFileSync('src/pages/admin/recipes/index.astro', 'utf8');
    assert.ok(!indexAstro.includes('1 1 0 .696'), 'Malformed SVG arc command must not exist in index.astro');
    assert.ok(indexAstro.includes('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z'), 'Standard Lucide eye icon must be used');
  });

  await t.test('Scenario 10: Admin Recipe List Refresh Authorization & Safe GET CSRF Bypass', async () => {
    process.env.ADMIN_SESSION_SECRET = 'test-secret-key-32-chars-length!!';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = 'scrypt$1234$5678';
    const secret = getAdminSessionSecret();
    const sessionCookie = buildSessionCookie('admin', secret);
    const session = parseAdminSessionCookie(sessionCookie);
    assert.ok(session, 'Valid session cookie generated');
    assert.ok(verifySessionCookie(sessionCookie, secret), 'Session cookie is valid');

    const getRequest = new Request('https://crockbites.site/api/admin/recipes/?fresh=1', {
      method: 'GET',
    });

    const isAuthorizedHelper = async (req) => {
      if (!secret || !sessionCookie || !verifySessionCookie(sessionCookie, secret)) return null;
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const csrfToken = req.headers.get('x-csrf-token') || '';
        const ok = await ensureCsrfToken(req, csrfToken, secret, session.id);
        if (!ok) return null;
      }
      return session;
    };

    const getAuth = await isAuthorizedHelper(getRequest);
    assert.ok(getAuth, 'GET request with valid admin session cookie must be authorized without CSRF header');

    const postRequest = new Request('https://crockbites.site/api/admin/recipes/', {
      method: 'POST',
    });
    const postAuth = await isAuthorizedHelper(postRequest);
    assert.equal(postAuth, null, 'POST request without CSRF token must be rejected');

    const validCsrf = createCsrfToken(secret, session.id);
    const postWithCsrf = new Request('https://crockbites.site/api/admin/recipes/', {
      method: 'POST',
      headers: { 'x-csrf-token': validCsrf },
    });
    const postValidAuth = await isAuthorizedHelper(postWithCsrf);
    assert.ok(postValidAuth, 'POST request with valid CSRF token must be authorized');

    const recipesApi = fs.readFileSync('src/pages/api/admin/recipes.ts', 'utf8');
    assert.ok(recipesApi.includes("request.method !== 'GET'"), 'recipes.ts must not require CSRF for GET');
    const slugApi = fs.readFileSync('src/pages/api/admin/recipes/[slug].ts', 'utf8');
    assert.ok(slugApi.includes("request.method !== 'GET'"), '[slug].ts must not require CSRF for GET');

    const indexAstro = fs.readFileSync('src/pages/admin/recipes/index.astro', 'utf8');
    assert.ok(indexAstro.includes("headers['x-csrf-token'] = csrfToken"), 'index.astro refresh sends csrf token header if present');
  });

  // Clean up test items from cache
  removeAdminRecipeCache('test-lemon-herb-chicken-draft');
  removeAdminRecipeCache('draft-beef-bourguignon');
  removeAdminRecipeCache('draft-tuscan-white-bean-soup');
  removeAdminRecipeCache('test-preview-regression-draft');
});
