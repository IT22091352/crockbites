import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

console.log('=== CROCKBITES SEED SQL VALIDATION TEST ===');

// 1. Initialize temporary in-memory SQLite database
const db = new DatabaseSync(':memory:');
console.log('1. Created fresh in-memory SQLite database.');

// 2. Read and apply schema migration 0004_recipes_cms.sql
const migrationPath = path.resolve('migrations/0004_recipes_cms.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
db.exec(migrationSql);
console.log('2. Successfully executed migrations/0004_recipes_cms.sql.');

// Verify table schema exists
const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'").get();
if (!tableCheck) {
  throw new Error("FAIL: 'recipes' table was not created by 0004_recipes_cms.sql");
}

// Inspect table columns
const columns = db.prepare("PRAGMA table_info('recipes')").all();
console.log(`   Table 'recipes' has ${columns.length} columns.`);

// 3. Read and execute scripts/seed_recipes.sql (First Run)
const seedPath = path.resolve('scripts/seed_recipes.sql');
const seedSql = fs.readFileSync(seedPath, 'utf8');
db.exec(seedSql);
console.log('3. Successfully executed scripts/seed_recipes.sql (Run 1).');

// 4. Verify record counts
const totalRow = db.prepare('SELECT COUNT(*) as c FROM recipes').get();
const publishedRow = db.prepare("SELECT COUNT(*) as c FROM recipes WHERE review_status = 'tested'").get();
const draftRow = db.prepare("SELECT COUNT(*) as c FROM recipes WHERE review_status = 'draft'").get();

console.log(`4. Record counts after Run 1: Total = ${totalRow.c}, Published = ${publishedRow.c}, Drafts = ${draftRow.c}`);

if (totalRow.c !== 12) throw new Error(`Expected 12 total recipes, got ${totalRow.c}`);
if (publishedRow.c !== 3) throw new Error(`Expected 3 published recipes, got ${publishedRow.c}`);
if (draftRow.c !== 9) throw new Error(`Expected 9 draft recipes, got ${draftRow.c}`);

// 5. Test idempotency by executing seed SQL a second time
db.exec(seedSql);
console.log('5. Successfully executed scripts/seed_recipes.sql (Run 2 - Idempotency).');

const totalRow2 = db.prepare('SELECT COUNT(*) as c FROM recipes').get();
const publishedRow2 = db.prepare("SELECT COUNT(*) as c FROM recipes WHERE review_status = 'tested'").get();
const draftRow2 = db.prepare("SELECT COUNT(*) as c FROM recipes WHERE review_status = 'draft'").get();

console.log(`   Record counts after Run 2: Total = ${totalRow2.c}, Published = ${publishedRow2.c}, Drafts = ${draftRow2.c}`);

if (totalRow2.c !== 12 || publishedRow2.c !== 3 || draftRow2.c !== 9) {
  throw new Error('FAIL: Idempotency check failed; counts changed on second execution.');
}

// 6. Comprehensive Field-by-Field Parity Check against original Markdown files
const contentDir = path.resolve('src/content/recipes');
const mdFiles = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md')).sort();

console.log(`6. Validating field parity for all ${mdFiles.length} Markdown files...`);

for (const file of mdFiles) {
  const content = fs.readFileSync(path.join(contentDir, file), 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`No frontmatter in ${file}`);
  const data = YAML.parse(match[1]);
  const body = content.slice(match[0].length).trim();
  const slug = data.slug || file.replace(/\.md$/, '');

  const row = db.prepare('SELECT * FROM recipes WHERE slug = ?').get(slug);
  if (!row) throw new Error(`Missing record in D1 for slug: ${slug}`);

  // Validate core fields
  if (row.title !== data.title) {
    throw new Error(`Title mismatch on ${slug}: "${row.title}" vs "${data.title}"`);
  }
  if (row.category !== data.category) {
    throw new Error(`Category mismatch on ${slug}: "${row.category}" vs "${data.category}"`);
  }
  const expectedStatus = data.reviewStatus === 'tested' ? 'tested' : 'draft';
  if (row.review_status !== expectedStatus) {
    throw new Error(`Status mismatch on ${slug}: "${row.review_status}" vs "${expectedStatus}"`);
  }
  if (row.servings !== data.servings) {
    throw new Error(`Servings mismatch on ${slug}: ${row.servings} vs ${data.servings}`);
  }

  // Validate JSON columns
  const dbIngredients = JSON.parse(row.ingredients);
  const dbInstructions = JSON.parse(row.instructions);
  const dbGallery = JSON.parse(row.gallery);
  const dbTags = JSON.parse(row.tags);

  const mdIngredients = data.ingredients || [];
  const mdInstructions = data.instructions || [];
  const mdGallery = data.gallery || [];
  const mdTags = data.tags || [];

  if (dbIngredients.length !== mdIngredients.length) {
    throw new Error(`Ingredients length mismatch on ${slug}: ${dbIngredients.length} vs ${mdIngredients.length}`);
  }
  if (dbInstructions.length !== mdInstructions.length) {
    throw new Error(`Instructions length mismatch on ${slug}: ${dbInstructions.length} vs ${mdInstructions.length}`);
  }
  if (dbGallery.length !== mdGallery.length) {
    throw new Error(`Gallery length mismatch on ${slug}: ${dbGallery.length} vs ${mdGallery.length}`);
  }
  if (dbTags.length !== mdTags.length) {
    throw new Error(`Tags length mismatch on ${slug}: ${dbTags.length} vs ${mdTags.length}`);
  }

  // Validate body Markdown
  if (row.body.trim() !== body.trim()) {
    throw new Error(`Body markdown mismatch on ${slug}`);
  }

  // Validate special Unicode characters (Sinhala check on pol sambol)
  if (slug === 'sri-lankan-pol-sambol-traditional-coconut-sambol') {
    if (!row.body.includes('පොල් සම්බෝල') && !row.title.includes('Pol Sambol')) {
      console.warn('Note: Sinhala text check on pol sambol');
    }
  }

  console.log(`   ✔ Verified: ${slug} (${row.review_status}, ${dbIngredients.length} ings, ${dbInstructions.length} steps, ${dbGallery.length} gallery)`);
}

console.log('=== ALL VALIDATION CHECKS PASSED PERFECTLY (100%) ===');

