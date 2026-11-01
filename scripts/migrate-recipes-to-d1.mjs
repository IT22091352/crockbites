import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

process.env.CROCKBITES_LOCAL_SQLITE = '1';
import { getDb } from '../src/lib/db.ts';

export async function migrateAllMarkdownRecipesToD1(db) {
  const dir = path.resolve(process.cwd(), 'src/content/recipes');
  if (!fs.existsSync(dir)) {
    throw new Error(`Recipe directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  console.log(`[CrockBites D1 Migration] Discovered ${files.length} Markdown recipes in ${dir}`);

  const results = [];

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      throw new Error(`Invalid recipe markdown (no frontmatter): ${filename}`);
    }

    const data = YAML.parse(match[1]);
    const body = content.slice(match[0].length).trim();
    const slug = data.slug || filename.replace(/\.md$/, '');

    const nowIso = new Date().toISOString();
    const pubDateIso = data.pubDate
      ? (data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10) : String(data.pubDate).slice(0, 10))
      : nowIso.slice(0, 10);
    const updatedDateIso = data.updatedDate
      ? (data.updatedDate instanceof Date ? data.updatedDate.toISOString().slice(0, 10) : String(data.updatedDate).slice(0, 10))
      : null;

    const imageUrl = typeof data.image === 'string' ? data.image : (data.image?.src || '/placeholder.svg');

    const record = {
      slug,
      title: String(data.title || 'Untitled Recipe'),
      seo_title: data.seoTitle ? String(data.seoTitle) : null,
      description: String(data.description || ''),
      seo_description: data.seoDescription ? String(data.seoDescription) : null,
      category: String(data.category || 'easy-dinners'),
      tags: JSON.stringify(Array.isArray(data.tags) ? data.tags : []),
      author: String(data.author || 'CrockBites'),
      image_url: imageUrl,
      image_alt: String(data.imageAlt || data.title || ''),
      gallery: JSON.stringify(Array.isArray(data.gallery) ? data.gallery : []),
      prep_minutes: Number(data.prepMinutes || 0),
      cook_minutes: Number(data.cookMinutes || 0),
      total_minutes: data.totalMinutes ? Number(data.totalMinutes) : null,
      cook_time_note: data.cookTimeNote ? String(data.cookTimeNote) : null,
      servings: Number(data.servings || 4),
      servings_label: String(data.servingsLabel || 'servings'),
      ingredients: JSON.stringify(Array.isArray(data.ingredients) ? data.ingredients : []),
      instructions: JSON.stringify(Array.isArray(data.instructions) ? data.instructions : []),
      serving_suggestions: JSON.stringify(Array.isArray(data.servingSuggestions) ? data.servingSuggestions : []),
      tips: JSON.stringify(Array.isArray(data.tips) ? data.tips : []),
      substitutions: JSON.stringify(Array.isArray(data.substitutions) ? data.substitutions : []),
      storage: JSON.stringify(data.storage && typeof data.storage === 'object' ? data.storage : {}),
      equipment: JSON.stringify(Array.isArray(data.equipment) ? data.equipment : []),
      food_safety: JSON.stringify(Array.isArray(data.foodSafety) ? data.foodSafety : []),
      dietary_labels: JSON.stringify(Array.isArray(data.dietaryLabels) ? data.dietaryLabels : []),
      dietary_verified: data.dietaryVerified ? 1 : 0,
      allergens: JSON.stringify(Array.isArray(data.allergens) ? data.allergens : []),
      allergen_reviewed: data.allergenReviewed ? 1 : 0,
      allergen_notes: data.allergenNotes ? String(data.allergenNotes) : null,
      nutrition: data.nutrition ? JSON.stringify(data.nutrition) : null,
      featured: data.featured ? 1 : 0,
      popular_rank: data.popularRank ? Number(data.popularRank) : null,
      related: JSON.stringify(Array.isArray(data.related) ? data.related : []),
      notify_newsletter: data.notifyNewsletter !== false && data.sendNewsletter !== false ? 1 : 0,
      review_status: data.reviewStatus === 'tested' ? 'tested' : 'draft',
      body,
      pub_date: pubDateIso,
      updated_date: updatedDateIso,
      created_at: pubDateIso + 'T00:00:00.000Z',
      updated_at: (updatedDateIso || pubDateIso) + 'T00:00:00.000Z',
    };

    // Idempotent UPSERT
    await db
      .prepare(
        `INSERT INTO recipes (
          slug, title, seo_title, description, seo_description, category, tags, author,
          image_url, image_alt, gallery, prep_minutes, cook_minutes, total_minutes, cook_time_note,
          servings, servings_label, ingredients, instructions, serving_suggestions, tips, substitutions,
          storage, equipment, food_safety, dietary_labels, dietary_verified, allergens, allergen_reviewed,
          allergen_notes, nutrition, featured, popular_rank, related, notify_newsletter, review_status,
          body, pub_date, updated_date, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(slug) DO UPDATE SET
          title = excluded.title,
          seo_title = excluded.seo_title,
          description = excluded.description,
          seo_description = excluded.seo_description,
          category = excluded.category,
          tags = excluded.tags,
          author = excluded.author,
          image_url = excluded.image_url,
          image_alt = excluded.image_alt,
          gallery = excluded.gallery,
          prep_minutes = excluded.prep_minutes,
          cook_minutes = excluded.cook_minutes,
          total_minutes = excluded.total_minutes,
          cook_time_note = excluded.cook_time_note,
          servings = excluded.servings,
          servings_label = excluded.servings_label,
          ingredients = excluded.ingredients,
          instructions = excluded.instructions,
          serving_suggestions = excluded.serving_suggestions,
          tips = excluded.tips,
          substitutions = excluded.substitutions,
          storage = excluded.storage,
          equipment = excluded.equipment,
          food_safety = excluded.food_safety,
          dietary_labels = excluded.dietary_labels,
          dietary_verified = excluded.dietary_verified,
          allergens = excluded.allergens,
          allergen_reviewed = excluded.allergen_reviewed,
          allergen_notes = excluded.allergen_notes,
          nutrition = excluded.nutrition,
          featured = excluded.featured,
          popular_rank = excluded.popular_rank,
          related = excluded.related,
          notify_newsletter = excluded.notify_newsletter,
          review_status = excluded.review_status,
          body = excluded.body,
          pub_date = excluded.pub_date,
          updated_date = excluded.updated_date,
          updated_at = excluded.updated_at`
      )
      .bind(
        record.slug,
        record.title,
        record.seo_title,
        record.description,
        record.seo_description,
        record.category,
        record.tags,
        record.author,
        record.image_url,
        record.image_alt,
        record.gallery,
        record.prep_minutes,
        record.cook_minutes,
        record.total_minutes,
        record.cook_time_note,
        record.servings,
        record.servings_label,
        record.ingredients,
        record.instructions,
        record.serving_suggestions,
        record.tips,
        record.substitutions,
        record.storage,
        record.equipment,
        record.food_safety,
        record.dietary_labels,
        record.dietary_verified,
        record.allergens,
        record.allergen_reviewed,
        record.allergen_notes,
        record.nutrition,
        record.featured,
        record.popular_rank,
        record.related,
        record.notify_newsletter,
        record.review_status,
        record.body,
        record.pub_date,
        record.updated_date,
        record.created_at,
        record.updated_at
      )
      .run();

    results.push({
      slug: record.slug,
      title: record.title,
      category: record.category,
      status: record.review_status,
      ingredientsCount: (data.ingredients || []).length,
      instructionsCount: (data.instructions || []).length,
    });
  }

  return results;
}

export function generateRecipeSeedSql() {
  const dir = path.resolve(process.cwd(), 'src/content/recipes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  const num = (v) => (v == null ? 'NULL' : Number(v));

  let sql = '-- CrockBites 12 Markdown Recipes Idempotent Seed\nPRAGMA foreign_keys = ON;\n\n';

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;
    const data = YAML.parse(match[1]);
    const body = content.slice(match[0].length).trim();
    const slug = data.slug || filename.replace(/\.md$/, '');
    const nowIso = new Date().toISOString();
    const pubDateIso = data.pubDate
      ? (data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10) : String(data.pubDate).slice(0, 10))
      : nowIso.slice(0, 10);
    const updatedDateIso = data.updatedDate
      ? (data.updatedDate instanceof Date ? data.updatedDate.toISOString().slice(0, 10) : String(data.updatedDate).slice(0, 10))
      : null;
    const imageUrl = typeof data.image === 'string' ? data.image : (data.image?.src || '/placeholder.svg');

    sql += `INSERT INTO recipes (
  slug, title, seo_title, description, seo_description, category, tags, author,
  image_url, image_alt, gallery, prep_minutes, cook_minutes, total_minutes, cook_time_note,
  servings, servings_label, ingredients, instructions, serving_suggestions, tips, substitutions,
  storage, equipment, food_safety, dietary_labels, dietary_verified, allergens, allergen_reviewed,
  allergen_notes, nutrition, featured, popular_rank, related, notify_newsletter, review_status,
  body, pub_date, updated_date, created_at, updated_at
) VALUES (
  ${esc(slug)}, ${esc(data.title || 'Untitled')}, ${esc(data.seoTitle)}, ${esc(data.description || '')}, ${esc(data.seoDescription)}, ${esc(data.category || 'easy-dinners')}, ${esc(JSON.stringify(data.tags || []))}, ${esc(data.author || 'CrockBites')},
  ${esc(imageUrl)}, ${esc(data.imageAlt || data.title || '')}, ${esc(JSON.stringify(data.gallery || []))}, ${num(data.prepMinutes || 0)}, ${num(data.cookMinutes || 0)}, ${num(data.totalMinutes)}, ${esc(data.cookTimeNote)},
  ${num(data.servings || 4)}, ${esc(data.servingsLabel || 'servings')}, ${esc(JSON.stringify(data.ingredients || []))}, ${esc(JSON.stringify(data.instructions || []))}, ${esc(JSON.stringify(data.servingSuggestions || []))}, ${esc(JSON.stringify(data.tips || []))}, ${esc(JSON.stringify(data.substitutions || []))},
  ${esc(JSON.stringify(data.storage || {}))}, ${esc(JSON.stringify(data.equipment || []))}, ${esc(JSON.stringify(data.foodSafety || []))}, ${esc(JSON.stringify(data.dietaryLabels || []))}, ${data.dietaryVerified ? 1 : 0}, ${esc(JSON.stringify(data.allergens || []))}, ${data.allergenReviewed ? 1 : 0},
  ${esc(data.allergenNotes)}, ${esc(data.nutrition ? JSON.stringify(data.nutrition) : null)}, ${data.featured ? 1 : 0}, ${num(data.popularRank)}, ${esc(JSON.stringify(data.related || []))}, ${data.notifyNewsletter !== false && data.sendNewsletter !== false ? 1 : 0}, ${data.reviewStatus === 'tested' ? "'tested'" : "'draft'"},
  ${esc(body)}, ${esc(pubDateIso)}, ${esc(updatedDateIso)}, ${esc(pubDateIso + 'T00:00:00.000Z')}, ${esc((updatedDateIso || pubDateIso) + 'T00:00:00.000Z')}
) ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  seo_title = excluded.seo_title,
  description = excluded.description,
  seo_description = excluded.seo_description,
  category = excluded.category,
  tags = excluded.tags,
  author = excluded.author,
  image_url = excluded.image_url,
  image_alt = excluded.image_alt,
  gallery = excluded.gallery,
  prep_minutes = excluded.prep_minutes,
  cook_minutes = excluded.cook_minutes,
  total_minutes = excluded.total_minutes,
  cook_time_note = excluded.cook_time_note,
  servings = excluded.servings,
  servings_label = excluded.servings_label,
  ingredients = excluded.ingredients,
  instructions = excluded.instructions,
  serving_suggestions = excluded.serving_suggestions,
  tips = excluded.tips,
  substitutions = excluded.substitutions,
  storage = excluded.storage,
  equipment = excluded.equipment,
  food_safety = excluded.food_safety,
  dietary_labels = excluded.dietary_labels,
  dietary_verified = excluded.dietary_verified,
  allergens = excluded.allergens,
  allergen_reviewed = excluded.allergen_reviewed,
  allergen_notes = excluded.allergen_notes,
  nutrition = excluded.nutrition,
  featured = excluded.featured,
  popular_rank = excluded.popular_rank,
  related = excluded.related,
  notify_newsletter = excluded.notify_newsletter,
  review_status = excluded.review_status,
  body = excluded.body,
  pub_date = excluded.pub_date,
  updated_date = excluded.updated_date,
  updated_at = excluded.updated_at;\n\n`;
  }

  return sql;
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].includes('migrate-recipes-to-d1')) {
  (async () => {
    try {
      if (process.argv.includes('--export-sql')) {
        const sql = generateRecipeSeedSql();
        const outPath = path.resolve(process.cwd(), 'scripts/seed_recipes.sql');
        fs.writeFileSync(outPath, sql, 'utf8');
        console.log(`[CrockBites D1 Migration] Exported SQL seed with 12 recipes to: ${outPath}`);
        return;
      }

      const db = await getDb();
      if (!db) {
        console.error('Failed to initialize D1 database adapter.');
        process.exit(1);
      }

      console.log('--- Migrating Markdown Recipes to Cloudflare D1 ---');
      const results = await migrateAllMarkdownRecipesToD1(db);
      console.table(results);

      // Verify count in D1
      const countRes = await db.prepare('SELECT COUNT(*) as total FROM recipes').first();
      console.log(`Verification: Total recipes in D1 = ${countRes.total}`);

      const publishedCountRes = await db.prepare("SELECT COUNT(*) as published FROM recipes WHERE review_status = 'tested'").first();
      const draftCountRes = await db.prepare("SELECT COUNT(*) as drafts FROM recipes WHERE review_status = 'draft'").first();
      console.log(`Verification: Published = ${publishedCountRes.published}, Drafts = ${draftCountRes.drafts}`);

      console.log('SUCCESS: All recipes successfully seeded into D1.');
    } catch (err) {
      console.error('Migration failed:', err);
      process.exit(1);
    }
  })();
}
