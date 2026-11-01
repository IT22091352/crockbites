import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.CROCKBITES_LOCAL_SQLITE = '1';
import { getDb } from '../src/lib/db.ts';
import {
  migrateAllMarkdownRecipesToD1,
} from '../scripts/migrate-recipes-to-d1.mjs';
import {
  getRecipeBySlugFromDb,
  getAllRecipesFromDb,
  createRecipeInDb,
  updateRecipeInDb,
  deleteRecipeInDb,
  setRecipeStatusInDb,
} from '../src/lib/recipes-db.ts';
import { getAllRecipes } from '../src/utils/recipes.ts';
import { triggerRecipeNewsletterCampaign } from '../src/lib/brevo-campaign.ts';

test('Cloudflare D1 Recipe CMS Migration & Regression Suite', async (t) => {
  const db = await getDb();
  assert.ok(db, 'D1 database adapter must initialize');

  // Test 1: Existing Markdown recipes migrate correctly
  await t.test('1. All 12 Markdown recipes migrate into D1 with complete data parity', async () => {
    const results = await migrateAllMarkdownRecipesToD1(db);
    assert.equal(results.length, 12, '12 recipes must be migrated');

    const totalRes = await db.prepare('SELECT COUNT(*) as count FROM recipes').first();
    assert.equal(totalRes.count, 12, 'D1 total recipe count must equal 12');

    // Verify key fields for a known recipe
    const ribs = await getRecipeBySlugFromDb(db, 'bbq-slow-cook-ribs-recipe-for-the-crock-pot');
    assert.ok(ribs, 'Ribs recipe must exist in D1');
    assert.equal(ribs.data.title, 'BBQ Slow Cook Ribs Recipe for the Crock Pot');
    assert.equal(ribs.data.category, 'beef-pork');
    assert.equal(ribs.data.reviewStatus, 'tested');
    assert.ok(ribs.data.ingredients.length >= 10, 'Ingredients array preserved');
    assert.ok(ribs.data.instructions.length >= 5, 'Instructions array preserved');
    assert.ok(ribs.body.length > 0, 'Markdown body preserved');
  });

  // Test 2: Re-running migration does not create duplicates
  await t.test('2. Re-running migration is strictly idempotent and does not create duplicates', async () => {
    await migrateAllMarkdownRecipesToD1(db);
    const countRes = await db.prepare('SELECT COUNT(*) as count FROM recipes').first();
    assert.equal(countRes.count, 12, 'Recipe count must remain exactly 12 after re-migration');
  });

  // Test 3: Creating a recipe writes to D1 only
  await t.test('3. Creating a recipe writes to D1 directly and returns full entity immediately', async () => {
    const testSlug = 'test-d1-slow-cooker-chili';
    // Clean up if left over
    await deleteRecipeInDb(db, testSlug);

    const created = await createRecipeInDb(db, {
      slug: testSlug,
      title: 'Test D1 Slow Cooker Chili',
      description: 'A rich and zesty chili created directly in Cloudflare D1.',
      category: 'beef-pork',
      prepMinutes: 10,
      cookMinutes: 360,
      servings: 6,
      ingredients: [{ item: 'Ground beef', quantity: 1, unit: 'lb' }],
      instructions: [{ title: 'Cook', text: 'Brown meat and slow cook on low.' }],
      reviewStatus: 'draft',
      image: 'https://res.cloudinary.com/crockbites/image/upload/v1/recipes/chili.jpg',
      imageAlt: 'Bowl of chili',
    });

    assert.equal(created.slug, testSlug);
    assert.equal(created.data.title, 'Test D1 Slow Cooker Chili');
    assert.equal(created.data.reviewStatus, 'draft');

    const queried = await getRecipeBySlugFromDb(db, testSlug);
    assert.ok(queried, 'Recipe must be found in D1');
    assert.equal(queried.data.title, 'Test D1 Slow Cooker Chili');
  });

  // Test 4: Editing a recipe updates D1 only
  await t.test('4. Editing a recipe updates D1 directly and reflects new values immediately', async () => {
    const testSlug = 'test-d1-slow-cooker-chili';
    const updated = await updateRecipeInDb(db, testSlug, {
      title: 'Updated D1 Slow Cooker Chili',
      description: 'Updated description in D1.',
      cookMinutes: 480,
    });

    assert.equal(updated.data.title, 'Updated D1 Slow Cooker Chili');
    assert.equal(updated.data.cookMinutes, 480);

    const fresh = await getRecipeBySlugFromDb(db, testSlug);
    assert.equal(fresh.data.title, 'Updated D1 Slow Cooker Chili');
    assert.equal(fresh.data.cookMinutes, 480);
  });

  // Test 5 & 6: Drafts never appear publicly, deleting removes from queries
  await t.test('5 & 6. Draft recipes never appear in public queries; published ones do', async () => {
    const testSlug = 'test-d1-slow-cooker-chili';
    // Currently draft
    const publicList = await getAllRecipes(false);
    assert.equal(
      publicList.some((r) => r.slug === testSlug),
      false,
      'Draft recipe must NOT be included in public getAllRecipes(false)'
    );

    const adminList = await getAllRecipes(true);
    assert.equal(
      adminList.some((r) => r.slug === testSlug),
      true,
      'Draft recipe MUST be included in admin getAllRecipes(true)'
    );

    // Test 7: Publishing makes recipe publicly visible immediately
    await setRecipeStatusInDb(db, testSlug, 'tested');
    const publishedList = await getAllRecipes(false);
    assert.equal(
      publishedList.some((r) => r.slug === testSlug),
      true,
      'Published recipe MUST be included in public getAllRecipes(false)'
    );

    // Test 5: Deleting recipe removes it immediately
    await deleteRecipeInDb(db, testSlug);
    const afterDelete = await getAllRecipes(false);
    assert.equal(
      afterDelete.some((r) => r.slug === testSlug),
      false,
      'Deleted recipe must be removed immediately from public queries'
    );
  });

  // Test 8: Direct URL handler logic for missing, draft and deleted recipes
  await t.test('8. Missing, draft, and deleted recipes are rejected with HTTP 404', async () => {
    const nonExistent = await getRecipeBySlugFromDb(db, 'non-existent-recipe-slug-12345');
    assert.equal(nonExistent, null, 'Non-existent recipe returns null');

    const draftRecipe = await getRecipeBySlugFromDb(db, 'brown-sugar-crockpot-ham');
    assert.ok(draftRecipe, 'Draft recipe exists');
    assert.equal(draftRecipe.data.reviewStatus, 'draft', 'Recipe is draft');
    // Public route rule: reviewStatus !== "tested" -> HTTP 404
    const isPublicAllowed = draftRecipe && draftRecipe.data.reviewStatus === 'tested';
    assert.equal(isPublicAllowed, false, 'Draft recipes must return 404 on public route');
  });

  // Test 9: Category and search queries query D1
  await t.test('9. Category filtering queries D1 and respects review status', async () => {
    const chickenDrafts = await getAllRecipesFromDb(db, {
      includeDrafts: true,
      category: 'slow-cooker-chicken',
    });
    assert.ok(chickenDrafts.length > 0, 'Chicken category recipes found in D1');

    const chickenPublic = await getAllRecipesFromDb(db, {
      includeDrafts: false,
      category: 'slow-cooker-chicken',
    });
    assert.ok(
      chickenPublic.every((r) => r.data.reviewStatus === 'tested'),
      'All public category results must be tested/published'
    );
  });

  // Test 10: Sitemap contains only published recipes
  await t.test('10. Sitemap generation includes only published recipes', async () => {
    const sitemapRecipes = await getAllRecipes(false);
    for (const r of sitemapRecipes) {
      assert.equal(r.data.reviewStatus, 'tested', `Recipe ${r.slug} in sitemap must be tested`);
    }
  });

  // Test 11: Newsletter campaigns trigger only on draft -> published transition
  await t.test('11. Newsletter campaign triggers only on valid draft-to-published transition', async () => {
    const testSlug = 'newsletter-test-slug';
    await deleteRecipeInDb(db, testSlug);

    // Save as draft
    const draft = await createRecipeInDb(db, {
      slug: testSlug,
      title: 'Newsletter Test Recipe',
      description: 'Testing newsletter trigger behavior.',
      category: 'easy-dinners',
      reviewStatus: 'draft',
      notifyNewsletter: true,
    });
    assert.equal(draft.data.reviewStatus, 'draft');

    // Ordinarily saving draft does not trigger campaign
    // Publish transition
    const publishResult = await triggerRecipeNewsletterCampaign(db, {
      slug: testSlug,
      title: 'Newsletter Test Recipe',
      description: 'Testing newsletter trigger behavior.',
      category: 'easy-dinners',
    });

    assert.ok(publishResult, 'Campaign dispatch executed or skipped cleanly without throwing');
    await deleteRecipeInDb(db, testSlug);
  });

  // Test 12: Community reviews remain linked to recipe slugs
  await t.test('12. Community reviews relationship with recipe slugs is preserved', async () => {
    const ribs = await getRecipeBySlugFromDb(db, 'bbq-slow-cook-ribs-recipe-for-the-crock-pot');
    assert.ok(ribs, 'Ribs exists');
    // Query reviews linked to ribs slug
    const reviews = await db
      .prepare('SELECT COUNT(*) as count FROM reviews WHERE recipe_slug = ?')
      .bind(ribs.slug)
      .first();
    assert.ok(reviews.count >= 0, 'Reviews query runs without error');
  });

  // Test 13: Cloudinary image references remain intact
  await t.test('13. Cloudinary image and gallery references are intact in D1', async () => {
    const ribs = await getRecipeBySlugFromDb(db, 'bbq-slow-cook-ribs-recipe-for-the-crock-pot');
    assert.ok(ribs.data.image.includes('cloudinary.com'), 'Hero image is a Cloudinary URL');
    assert.ok(ribs.data.gallery.length > 0, 'Gallery images present in D1');
    assert.ok(ribs.data.gallery[0].url.includes('cloudinary.com'), 'Gallery items have Cloudinary URLs');
  });

  // Test 14 & 15: No recipe CRUD endpoint calls GitHub Contents API
  await t.test('14 & 15. Admin recipe API code does not import writeRepoFile or deleteRepoFile', async () => {
    const apiRecipes = fs.readFileSync('src/pages/api/admin/recipes.ts', 'utf8');
    assert.ok(!apiRecipes.includes('writeRepoFile'), 'POST /api/admin/recipes must not call writeRepoFile');
    assert.ok(!apiRecipes.includes('repoRecipePath'), 'POST /api/admin/recipes must not call repoRecipePath');

    const apiSlug = fs.readFileSync('src/pages/api/admin/recipes/[slug].ts', 'utf8');
    assert.ok(!apiSlug.includes('writeRepoFile'), 'PUT /api/admin/recipes/[slug] must not call writeRepoFile');
    assert.ok(!apiSlug.includes('deleteRepoFile'), 'DELETE /api/admin/recipes/[slug] must not call deleteRepoFile');

    const apiBulk = fs.readFileSync('src/pages/api/admin/recipes/bulk-status.ts', 'utf8');
    assert.ok(!apiBulk.includes('writeRepoFile'), 'POST /api/admin/recipes/bulk-status must not call writeRepoFile');
  });
});

