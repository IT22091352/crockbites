-- CrockBites Phase 3: Recipe Newsletter Notifications Log
-- Cloudflare D1 (SQLite) Migration: 0003_recipe_newsletter_notifications.sql

CREATE TABLE IF NOT EXISTS recipe_newsletter_notifications (
  id TEXT PRIMARY KEY,
  recipe_slug TEXT NOT NULL UNIQUE,
  recipe_title TEXT NOT NULL,
  campaign_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  list_id INTEGER NOT NULL DEFAULT 3,
  recipient_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipe_newsletter_slug ON recipe_newsletter_notifications(recipe_slug);
CREATE INDEX IF NOT EXISTS idx_recipe_newsletter_status ON recipe_newsletter_notifications(status);

