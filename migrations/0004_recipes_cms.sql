-- CrockBites Phase 4: Cloudflare D1 Recipe Content Management System
-- Cloudflare D1 (SQLite) Migration: 0004_recipes_cms.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS recipes (
  slug TEXT PRIMARY KEY COLLATE NOCASE,
  title TEXT NOT NULL,
  seo_title TEXT,
  description TEXT NOT NULL,
  seo_description TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'slow-cooker-chicken', 'beef-pork', 'soups-stews', 'easy-dinners',
    'breakfast', 'vegetarian', 'desserts-baking'
  )),
  tags TEXT NOT NULL DEFAULT '[]',
  author TEXT NOT NULL DEFAULT 'CrockBites',
  image_url TEXT NOT NULL,
  image_alt TEXT NOT NULL DEFAULT '',
  gallery TEXT NOT NULL DEFAULT '[]',
  prep_minutes INTEGER NOT NULL DEFAULT 0,
  cook_minutes INTEGER NOT NULL DEFAULT 0,
  total_minutes INTEGER,
  cook_time_note TEXT,
  servings INTEGER NOT NULL DEFAULT 4,
  servings_label TEXT NOT NULL DEFAULT 'servings',
  ingredients TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '[]',
  serving_suggestions TEXT NOT NULL DEFAULT '[]',
  tips TEXT NOT NULL DEFAULT '[]',
  substitutions TEXT NOT NULL DEFAULT '[]',
  storage TEXT NOT NULL DEFAULT '{}',
  equipment TEXT NOT NULL DEFAULT '[]',
  food_safety TEXT NOT NULL DEFAULT '[]',
  dietary_labels TEXT NOT NULL DEFAULT '[]',
  dietary_verified INTEGER NOT NULL DEFAULT 0 CHECK (dietary_verified IN (0, 1)),
  allergens TEXT NOT NULL DEFAULT '[]',
  allergen_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (allergen_reviewed IN (0, 1)),
  allergen_notes TEXT,
  nutrition TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  popular_rank INTEGER,
  related TEXT NOT NULL DEFAULT '[]',
  notify_newsletter INTEGER NOT NULL DEFAULT 1 CHECK (notify_newsletter IN (0, 1)),
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'tested')),
  body TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL,
  updated_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_review_status ON recipes(review_status);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
CREATE INDEX IF NOT EXISTS idx_recipes_pub_date ON recipes(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_recipes_featured ON recipes(featured);
CREATE INDEX IF NOT EXISTS idx_recipes_status_category ON recipes(review_status, category);
CREATE INDEX IF NOT EXISTS idx_recipes_status_updated ON recipes(review_status, updated_at DESC);

