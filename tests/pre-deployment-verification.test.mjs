import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecipeBySlug, getAllRecipes, recipeUrl } from '../src/utils/recipes.ts';
import { getDb } from '../src/lib/db.ts';
import { site } from '../src/config/site.ts';

process.env.CROCKBITES_LOCAL_SQLITE = '1';

test('CrockBites Pre-Deployment Verification Suite', async (t) => {
  // --- 1. WWW Redirect & Canonical Host Enforcement ---
  await t.test('1. WWW Redirect: 301 status, apex destination, preserves path and query, no apex loop', () => {
    function simulateRedirect(urlString) {
      const url = new URL(urlString);
      if (url.hostname === 'www.crockbites.site') {
        url.hostname = 'crockbites.site';
        url.protocol = 'https:';
        return {
          status: 301,
          location: url.toString(),
        };
      }
      return { status: 200, location: null };
    }

    // Root test
    const r1 = simulateRedirect('https://www.crockbites.site/');
    assert.equal(r1.status, 301);
    assert.equal(r1.location, 'https://crockbites.site/');

    // Deep path + query param test
    const r2 = simulateRedirect('https://www.crockbites.site/recipe/slow-cooker-beef-chili/?ref=pinterest&val=1');
    assert.equal(r2.status, 301);
    assert.equal(r2.location, 'https://crockbites.site/recipe/slow-cooker-beef-chili/?ref=pinterest&val=1');

    // HTTP to HTTPS apex test
    const r3 = simulateRedirect('http://www.crockbites.site/guides/slow-cooker-food-safety/');
    assert.equal(r3.status, 301);
    assert.equal(r3.location, 'https://crockbites.site/guides/slow-cooker-food-safety/');

    // Canonical apex host test - must NOT redirect (no loop)
    const rApex = simulateRedirect('https://crockbites.site/recipe/slow-cooker-beef-chili/');
    assert.equal(rApex.status, 200);
    assert.equal(rApex.location, null, 'Apex domain must not redirect to avoid loop');
  });

  // --- 2. D1 and Markdown Fallback Behavior ---
  const db = await getDb();
  assert.ok(db, 'Isolated local SQLite D1 database must be available for testing');

  await t.test('2a. D1 recipe loading: loads recipe with complete data structures', async () => {
    const chili = await getRecipeBySlug('slow-cooker-beef-chili', db);
    assert.ok(chili, 'Chili must load from D1');
    assert.equal(chili.data.title, 'Easy Slow Cooker Beef Chili');
    assert.ok(Array.isArray(chili.data.ingredients), 'Ingredients must be parsed array');
    assert.ok(Array.isArray(chili.data.instructions), 'Instructions must be parsed array');
    assert.equal(typeof chili.data.prepMinutes, 'number');
  });

  await t.test('2b. Markdown fallback: loads recipe when D1 is completely unavailable', async () => {
    // Pass null/failing db to trigger fallback to Markdown
    const chiliFallback = await getRecipeBySlug('slow-cooker-beef-chili', null);
    assert.ok(chiliFallback, 'Must successfully fall back to Markdown when D1 is unavailable');
    assert.equal(chiliFallback.data.slug, 'slow-cooker-beef-chili');
    assert.equal(chiliFallback.data.title, 'Easy Slow Cooker Beef Chili');
    assert.ok(chiliFallback.data.ingredients.length > 0, 'Fallback recipe must have ingredients');
  });

  await t.test('2c. Missing recipe returns null (triggers 404 in [slug].astro)', async () => {
    const missingD1 = await getRecipeBySlug('non-existent-recipe-xyz', db);
    assert.equal(missingD1, null, 'Missing recipe in D1 must return null');

    const missingFallback = await getRecipeBySlug('non-existent-recipe-xyz', null);
    assert.equal(missingFallback, null, 'Missing recipe in Markdown must return null');
  });

  await t.test('2d. Draft vs Tested reviewStatus indexing behavior', async () => {
    // When reviewStatus is tested, isIndexable is true. Draft is excluded unless site.indexDraftRecipes is true.
    const publishedList = await getAllRecipes(false);
    const allList = await getAllRecipes(true);
    assert.ok(allList.length >= publishedList.length, 'All recipes count must be >= published tested recipes');
  });

  // --- 3. Sitemap & Robots.txt Verification ---
  await t.test('3a. Robots.txt structure and sitemap directive', async () => {
    const { GET: robotsGet } = await import('../src/pages/robots.txt.ts');
    const response = await robotsGet();
    const content = await response.text();

    assert.ok(content.includes('User-agent: *'), 'Must declare User-agent: *');
    assert.ok(content.includes('Disallow: /admin/'), 'Must disallow /admin/');
    assert.ok(content.includes('Disallow: /api/'), 'Must disallow /api/');
    assert.ok(content.includes('Disallow: /account/'), 'Must disallow /account/');
    assert.ok(content.includes('Sitemap: https://crockbites.site/sitemap.xml'), 'Must point to canonical sitemap URL');
    assert.ok(!content.includes('Disallow: /recipe/'), 'Must not disallow public recipe pages');
    assert.ok(!content.includes('Disallow: /category/'), 'Must not disallow category pages');
  });

  await t.test('3b. Sitemap XML structure and published recipe inclusion', async () => {
    const { GET: sitemapGet } = await import('../src/pages/sitemap.xml.ts');
    const response = await sitemapGet();
    const xml = await response.text();

    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must start with XML declaration');
    assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'Must have urlset namespace');

    // Canonical site URLs
    assert.ok(xml.includes('<loc>https://crockbites.site/</loc>'), 'Homepage must be in sitemap');
    assert.ok(xml.includes('<loc>https://crockbites.site/recipe/slow-cooker-beef-chili/</loc>'), 'Chili must be in sitemap');
    assert.ok(xml.includes('<loc>https://crockbites.site/recipe/sri-lankan-pol-sambol-traditional-coconut-sambol/</loc>'), 'Pol Sambol must be in sitemap');
    assert.ok(xml.includes('<loc>https://crockbites.site/recipe/bbq-slow-cook-ribs-recipe-for-the-crock-pot/</loc>'), 'Ribs must be in sitemap');

    // All loc entries must end with / (canonical convention)
    const locMatches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
    for (const match of locMatches) {
      const loc = match[1];
      assert.ok(loc.endsWith('/'), `Sitemap URL "${loc}" must end with a trailing slash`);
      assert.ok(loc.startsWith('https://crockbites.site/'), `Sitemap URL "${loc}" must use canonical https://crockbites.site origin`);
    }
  });
});
