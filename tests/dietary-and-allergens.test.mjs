import assert from 'node:assert/strict';
import {
  allowedDietaryLabels,
  allowedAllergens,
  normalizeDietaryLabels,
  normalizeAllergens,
  normalizeRecipePayload,
  serializeRecipeToMarkdown,
} from '../src/lib/recipe-admin.ts';

// 1. Dietary Enum & Invalid Values Rejection
const rawDietary = ['Vegetarian', 'GLUTEN-FREE', 'invalid-fad-diet', 'KETO-FRIENDLY', '', null, 123];
const normalizedDietary = normalizeDietaryLabels(rawDietary);

assert.deepEqual(
  normalizedDietary,
  ['vegetarian', 'gluten-free', 'keto-friendly'],
  'normalizes valid dietary labels to lowercase and rejects invalid or malformed entries'
);
assert.equal(allowedDietaryLabels.length, 10, 'supports all 10 standard dietary labels');

// 2. Allergen Enum & Invalid Values Rejection
const rawAllergens = ['Milk', 'EGGS', 'wheat', 'peanuts', 'MSG', 'corn', 'sesame', undefined];
const normalizedAllergens = normalizeAllergens(rawAllergens);

assert.deepEqual(
  normalizedAllergens,
  ['milk', 'eggs', 'wheat', 'peanuts', 'sesame'],
  'normalizes valid FDA Big 9 allergens and filters unknown allergens'
);
assert.equal(allowedAllergens.length, 9, 'supports all FDA Big 9 allergens');

// 3. Normalization & Frontmatter Persistence
const fullRecipePayload = {
  title: 'Gluten-Free Minestrone Soup',
  description: 'Hearty slow-cooked soup loaded with fresh vegetables and beans.',
  category: 'soups-stews',
  image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  imageAlt: 'Bowl of minestrone soup',
  prepMinutes: 15,
  cookMinutes: 360,
  servings: 6,
  ingredients: [{ item: 'Vegetable broth', quantity: 4, unit: 'cups' }],
  instructions: [{ text: 'Combine all ingredients in slow cooker and cook on low.' }],
  dietaryLabels: ['vegetarian', 'vegan', 'gluten-free'],
  dietaryVerified: true,
  allergens: [],
  allergenReviewed: true,
  allergenNotes: 'Prepared in a dedicated nut-free kitchen.',
  nutrition: {
    calories: 220,
    proteinGrams: 8,
    carbsGrams: 36,
    fatGrams: 3.5,
    sodiumMilligrams: 540,
    source: 'USDA FoodData Central #173456',
    verifiedDate: '2026-10-30',
  },
};

const normalized = normalizeRecipePayload(fullRecipePayload);
assert.equal(normalized.dietaryVerified, true, 'dietaryVerified preserved as boolean true');
assert.deepEqual(normalized.dietaryLabels, ['vegetarian', 'vegan', 'gluten-free'], 'dietary labels normalized and preserved');
assert.equal(normalized.allergenReviewed, true, 'allergenReviewed preserved as boolean true');
assert.equal(normalized.allergenNotes, 'Prepared in a dedicated nut-free kitchen.', 'allergen notes preserved');
assert.ok(normalized.nutrition, 'existing nutrition data preserved alongside dietary/allergens');
assert.equal(normalized.nutrition.calories, 220, 'nutrition values intact');

const serialized = serializeRecipeToMarkdown(normalized);
assert.ok(serialized.includes('dietaryLabels:'), 'serialized markdown contains dietaryLabels');
assert.ok(serialized.includes('- vegetarian'), 'serialized markdown contains vegetarian');
assert.ok(serialized.includes('- gluten-free'), 'serialized markdown contains gluten-free');
assert.ok(serialized.includes('dietaryVerified: true'), 'serialized markdown contains dietaryVerified: true');
assert.ok(serialized.includes('allergenReviewed: true'), 'serialized markdown contains allergenReviewed: true');
assert.ok(serialized.includes('Dedicated nut-free kitchen') || serialized.includes('Prepared in a dedicated nut-free kitchen.'), 'allergen notes serialized');
assert.ok(serialized.includes('nutrition:'), 'nutrition block retained');
assert.ok(serialized.includes('calories: 220'), 'calories preserved');

// 4. Unverified Dietary Labels Behavior
const unverifiedRecipe = normalizeRecipePayload({
  title: 'Draft Cauliflower Stew',
  dietaryLabels: ['vegan', 'low-carb'],
  dietaryVerified: false,
});
assert.equal(unverifiedRecipe.dietaryVerified, false, 'dietaryVerified is false');
assert.deepEqual(unverifiedRecipe.dietaryLabels, ['vegan', 'low-carb'], 'labels preserved in CMS payload for editorial review');

const serializedUnverified = serializeRecipeToMarkdown(unverifiedRecipe);
assert.ok(serializedUnverified.includes('dietaryVerified: false'), 'dietaryVerified: false serialized');

// 5. Discovery & Search Filtering Logic Simulation
// Define representative mock dataset:
const mockDataset = [
  {
    title: 'Comforting Vegan Stew',
    category: 'soups-stews',
    hay: 'comforting vegan stew soups-stews potato carrots',
    dietaryVerified: true,
    dietaryLabels: ['vegetarian', 'vegan', 'gluten-free'],
    allergenReviewed: true,
    allergens: [],
  },
  {
    title: 'High Protein Chicken Bowl',
    category: 'slow-cooker-chicken',
    hay: 'high protein chicken bowl slow-cooker-chicken rice',
    dietaryVerified: true,
    dietaryLabels: ['high-protein', 'gluten-free', 'dairy-free'],
    allergenReviewed: true,
    allergens: ['soybeans'],
  },
  {
    title: 'Creamy Parmesan Tuscan Chicken',
    category: 'slow-cooker-chicken',
    hay: 'creamy parmesan tuscan chicken slow-cooker-chicken cream spinach',
    dietaryVerified: true,
    dietaryLabels: ['low-carb', 'keto-friendly'],
    allergenReviewed: true,
    allergens: ['milk'],
  },
  {
    title: 'Claimed Keto Beef Roast (Unverified)',
    category: 'beef-pork',
    hay: 'claimed keto beef roast beef-pork garlic herbs',
    dietaryVerified: false, // UNVERIFIED!
    dietaryLabels: ['keto-friendly', 'low-carb'],
    allergenReviewed: false, // UNREVIEWED!
    allergens: [],
  },
  {
    title: 'Old Family Pork Chops (Unreviewed Allergens)',
    category: 'beef-pork',
    hay: 'old family pork chops beef-pork apple glaze',
    dietaryVerified: false,
    dietaryLabels: [],
    allergenReviewed: false, // UNREVIEWED!
    allergens: [],
  },
];

function filterRecipes({ q = '', category = '', dietary = [], excludeAllergens = [] }) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tokens = norm(q).split(/\s+/).filter(Boolean);

  return mockDataset.filter((r) => {
    // 1. Category check
    if (category && r.category !== category) return false;

    // 2. Query check
    if (tokens.length > 0 && !tokens.every((t) => r.hay.includes(t))) return false;

    // 3. Dietary check: MUST be dietaryVerified and contain ALL chosen dietary labels
    if (dietary.length > 0) {
      if (!r.dietaryVerified) return false;
      const matchesAll = dietary.every((lbl) => r.dietaryLabels.includes(lbl));
      if (!matchesAll) return false;
    }

    // 4. Allergen check:
    // SAFETY RULE: When excluding allergens, unreviewed recipes MUST be excluded as unsafe
    if (excludeAllergens.length > 0) {
      if (!r.allergenReviewed) return false;
      const containsExcluded = excludeAllergens.some((allg) => r.allergens.includes(allg));
      if (containsExcluded) return false;
    }

    return true;
  });
}

// Test 5.1: Unverified dietary labels MUST NOT match dietary filters
const ketoResults = filterRecipes({ dietary: ['keto-friendly'] });
assert.equal(ketoResults.length, 1, 'only verified keto recipe returned');
assert.equal(ketoResults[0].title, 'Creamy Parmesan Tuscan Chicken');
assert.ok(!ketoResults.some((r) => r.title.includes('Unverified')), 'unverified recipe excluded from dietary results');

// Test 5.2: Multiple dietary filters (AND logic)
const veganGlutenFree = filterRecipes({ dietary: ['vegan', 'gluten-free'] });
assert.equal(veganGlutenFree.length, 1, 'matches recipe with both vegan and gluten-free');
assert.equal(veganGlutenFree[0].title, 'Comforting Vegan Stew');

// Test 5.3: Allergen exclusion safety — Unreviewed recipes must be excluded
const excludeMilk = filterRecipes({ excludeAllergens: ['milk'] });
assert.ok(
  !excludeMilk.some((r) => r.title.includes('Unreviewed') || r.title.includes('Unverified')),
  'unreviewed allergen recipes are strictly excluded when allergen filter is active'
);
assert.ok(
  !excludeMilk.some((r) => r.allergens.includes('milk')),
  'recipes containing milk are excluded'
);
assert.equal(excludeMilk.length, 2, 'only reviewed recipes without milk qualify');

// Test 5.4: Combined filter: query + category + dietary + allergen exclusion
const combined = filterRecipes({
  q: 'chicken',
  category: 'slow-cooker-chicken',
  dietary: ['gluten-free'],
  excludeAllergens: ['milk'],
});
assert.equal(combined.length, 1, 'only High Protein Chicken Bowl matches combined filters');
assert.equal(combined[0].title, 'High Protein Chicken Bowl');

// 6. Backward Compatibility: Existing recipes without new fields
const legacyRecipe = normalizeRecipePayload({
  title: 'Legacy Slow Cooker Pulled Pork',
  category: 'beef-pork',
  prepMinutes: 10,
  cookMinutes: 480,
  servings: 8,
  ingredients: [{ item: 'Pork shoulder', quantity: 4, unit: 'lb' }],
  instructions: [{ text: 'Cook on low 8 hours.' }],
});

assert.deepEqual(legacyRecipe.dietaryLabels, [], 'defaults to empty array for legacy recipes');
assert.equal(legacyRecipe.dietaryVerified, false, 'defaults to unverified false');
assert.deepEqual(legacyRecipe.allergens, [], 'defaults to empty array for legacy recipes');
assert.equal(legacyRecipe.allergenReviewed, false, 'defaults to unreviewed false');

const serializedLegacy = serializeRecipeToMarkdown(legacyRecipe);
assert.ok(serializedLegacy.includes('title: Legacy Slow Cooker Pulled Pork'));
assert.ok(!serializedLegacy.includes('allergenReviewed: true'));

console.log('dietary-and-allergens unit and safety tests passed');

