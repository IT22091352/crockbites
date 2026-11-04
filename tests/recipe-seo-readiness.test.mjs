import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeSchema, toJsonLd } from '../src/utils/jsonld.ts';
import { getRecipeBySlug, recipeUrl } from '../src/utils/recipes.ts';
import { getDb } from '../src/lib/db.ts';

process.env.CROCKBITES_LOCAL_SQLITE = '1';

test('CrockBites Recipe SEO Readiness & Food Safety Audit Suite', async (t) => {
  const db = await getDb();
  assert.ok(db, 'Local SQLite D1 database must be available');

  // 1. Google Recipe JSON-LD Structured Data Audit
  await t.test('1. Structured Data: recipeInstructions does not assign fake or gallery images to steps', () => {
    const mockRecipe = {
      id: 'test-recipe',
      data: {
        title: 'Test Dish',
        slug: 'test-dish',
        description: 'A test slow cooker dish.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 10,
        cookMinutes: 240,
        servings: 4,
        servingsLabel: 'servings',
        category: 'beef-pork',
        tags: ['dinner', 'slow cooker'],
        ingredients: [{ item: 'Beef', quantity: 1, unit: 'lb' }],
        instructions: [
          { title: 'Step 1', text: 'Chop onions.' },
          { title: 'Step 2', text: 'Cook in crockpot.' },
        ],
      },
    };

    const schema = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', 'Beef & Pork');
    assert.equal(schema['@type'], 'Recipe');
    assert.equal(schema.recipeInstructions.length, 2);

    for (const step of schema.recipeInstructions) {
      assert.equal(step['@type'], 'HowToStep');
      // Step images must be absent when no step-specific photo exists
      assert.equal((step).image, undefined, 'HowToStep must omit image property when no step-specific photo exists');
    }
  });

  await t.test('2. Structured Data: Nutrition is cleanly omitted when genuine nutritional calculation is unavailable', () => {
    const mockRecipe = {
      id: 'no-nutrition-recipe',
      data: {
        title: 'No Nutrition Dish',
        slug: 'no-nutrition-dish',
        description: 'Test dish without nutrition.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 10,
        cookMinutes: 240,
        servings: 4,
        servingsLabel: 'servings',
        category: 'beef-pork',
        tags: [],
        ingredients: [],
        instructions: [],
        nutrition: null,
      },
    };

    const schema = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', 'Beef & Pork');
    assert.equal((schema).nutrition, undefined, 'Nutrition property must be completely omitted when null');
    const jsonStr = toJsonLd(schema);
    assert.ok(!jsonStr.includes('NutritionInformation'), 'JSON-LD must not emit NutritionInformation');
  });

  await t.test('3. Structured Data: AggregateRating is strictly omitted when review count is 0', () => {
    const mockRecipe = {
      id: 'unrated-recipe',
      data: {
        title: 'Unrated Dish',
        slug: 'unrated-dish',
        description: 'Test dish without reviews.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 10,
        cookMinutes: 240,
        servings: 4,
        servingsLabel: 'servings',
        category: 'beef-pork',
        tags: [],
        ingredients: [],
        instructions: [],
      },
    };

    // When reviews is null
    const schemaNull = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', 'Beef & Pork', null);
    assert.equal((schemaNull).aggregateRating, undefined, 'AggregateRating must be omitted when reviews is null');

    // When reviews has count 0
    const schemaZero = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', 'Beef & Pork', { ratingValue: 0, reviewCount: 0 });
    assert.equal((schemaZero).aggregateRating, undefined, 'AggregateRating must be omitted when reviewCount is 0');

    // When genuine reviews exist
    const schemaWithReviews = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', 'Beef & Pork', { ratingValue: 4.8, reviewCount: 5 });
    assert.ok((schemaWithReviews).aggregateRating, 'AggregateRating must be present when genuine reviews exist');
    assert.equal((schemaWithReviews).aggregateRating.ratingValue, 4.8);
    assert.equal((schemaWithReviews).aggregateRating.reviewCount, 5);
  });

  await t.test('4. Structured Data: recipeCuisine is added only when editorially supported', () => {
    // Pol Sambol
    const polSambol = {
      id: 'sri-lankan-pol-sambol-traditional-coconut-sambol',
      data: {
        title: 'Sri Lankan Pol Sambol',
        slug: 'sri-lankan-pol-sambol-traditional-coconut-sambol',
        description: 'Authentic coconut relish.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 15,
        cookMinutes: 0,
        servings: 4,
        servingsLabel: 'servings',
        category: 'breakfast',
        tags: ['sri lankan', 'pol sambol'],
        ingredients: [],
        instructions: [],
      },
    };

    const polSchema = recipeSchema(polSambol, 'https://res.cloudinary.com/demo/sample.jpg', 'Breakfast');
    assert.equal((polSchema).recipeCuisine, 'Sri Lankan', 'Pol Sambol must declare Sri Lankan cuisine');
    assert.equal((polSchema).cookTime, undefined, 'No-cook Pol Sambol must omit cookTime');

    // BBQ Ribs
    const ribs = {
      id: 'bbq-slow-cook-ribs-recipe-for-the-crock-pot',
      data: {
        title: 'BBQ Slow Cook Ribs',
        slug: 'bbq-slow-cook-ribs-recipe-for-the-crock-pot',
        description: 'Tender BBQ ribs.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 15,
        cookMinutes: 480,
        servings: 4,
        servingsLabel: 'servings',
        category: 'beef-pork',
        tags: ['bbq', 'ribs'],
        ingredients: [],
        instructions: [],
      },
    };

    const ribsSchema = recipeSchema(ribs, 'https://res.cloudinary.com/demo/sample.jpg', 'Beef & Pork');
    assert.equal((ribsSchema).recipeCuisine, 'American', 'BBQ Ribs must declare American cuisine');
    assert.equal((ribsSchema).cookTime, 'PT8H', 'Ribs cookTime must be valid ISO duration');

    // Unsupported generic recipe
    const generic = {
      id: 'generic-dish',
      data: {
        title: 'Generic Dish',
        slug: 'generic-dish',
        description: 'Generic dish.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 10,
        cookMinutes: 60,
        servings: 4,
        servingsLabel: 'servings',
        category: 'easy-dinners',
        tags: ['easy'],
        ingredients: [],
        instructions: [],
      },
    };

    const genericSchema = recipeSchema(generic, 'https://res.cloudinary.com/demo/sample.jpg', 'Easy Dinners');
    assert.equal((genericSchema).recipeCuisine, undefined, 'Generic dish without editorial cuisine declaration must omit recipeCuisine');
  });

  await t.test('5. Structured Data: Video property is cleanly omitted (no fake VideoObject schema)', () => {
    const mockRecipe = {
      id: 'test-recipe',
      data: {
        title: 'Test Dish',
        slug: 'test-dish',
        description: 'A test slow cooker dish.',
        author: 'CrockBites',
        pubDate: new Date('2026-10-30'),
        prepMinutes: 10,
        cookMinutes: 240,
        servings: 4,
        servingsLabel: 'servings',
        category: 'beef-pork',
        tags: [],
        ingredients: [],
        instructions: [],
      },
    };

    const schema = recipeSchema(mockRecipe, 'https://res.cloudinary.com/demo/sample.jpg', 'Beef & Pork');
    assert.equal((schema).video, undefined, 'Video property must be omitted');
    const jsonStr = toJsonLd(schema);
    assert.ok(!jsonStr.includes('VideoObject'), 'JSON-LD must not include VideoObject');
  });

  // 2. Food Safety & Recipe Data Loading
  await t.test('6. Brown Sugar Crockpot Ham: Loads from database or collection with valid structure', async () => {
    const ham = await getRecipeBySlug('brown-sugar-crockpot-ham', db);
    assert.ok(ham, 'Ham recipe must exist');
    assert.ok(Array.isArray(ham.data.instructions), 'Instructions must be an array');
    assert.ok(Array.isArray(ham.data.ingredients), 'Ingredients must be an array');
  });

  await t.test('7. Easy Slow Cooker Beef Chili: Loads with valid ingredients and instructions', async () => {
    const chili = await getRecipeBySlug('slow-cooker-beef-chili', db);
    assert.ok(chili, 'Chili recipe must exist');
    assert.ok(Array.isArray(chili.data.ingredients), 'Ingredients must be an array');
    assert.ok(Array.isArray(chili.data.instructions), 'Instructions must be an array');
  });

  await t.test('8. Sri Lankan Pol Sambol: Cook time is 0 and recipe data loads correctly', async () => {
    const pol = await getRecipeBySlug('sri-lankan-pol-sambol-traditional-coconut-sambol', db);
    assert.ok(pol, 'Pol Sambol recipe must exist');
    assert.equal(pol.data.cookMinutes, 0, 'Pol Sambol cookMinutes must be 0 (raw)');
  });

  await t.test('9. BBQ Slow Cook Ribs: Loads with valid cooking times and structure', async () => {
    const ribs = await getRecipeBySlug('bbq-slow-cook-ribs-recipe-for-the-crock-pot', db);
    assert.ok(ribs, 'Ribs recipe must exist');
    assert.ok(ribs.data.cookMinutes > 0, 'Ribs cookMinutes must be > 0');
  });

  // 3. Routing, Canonical URL, and 404 Resolution
  await t.test('10. Recipe URL generation matches site canonical convention with trailing slash', async () => {
    const ribs = await getRecipeBySlug('bbq-slow-cook-ribs-recipe-for-the-crock-pot', db);
    assert.ok(ribs, 'Ribs recipe must be found');
    const url = recipeUrl(ribs);
    assert.equal(url, '/recipe/bbq-slow-cook-ribs-recipe-for-the-crock-pot/', 'Canonical URL must end with trailing slash');
  });

  await t.test('11. Non-existent recipe returns null from getRecipeBySlug', async () => {
    const missing = await getRecipeBySlug('completely-non-existent-recipe-slug-xyz', db);
    assert.equal(missing, null, 'Non-existent recipe must return null');
  });
});
