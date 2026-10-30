-- CrockBites Phase 3: User Accounts & Community Platform
-- Cloudflare D1 (SQLite) Migration: 0001_community_platform.sql

PRAGMA foreign_keys = ON;

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator')),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. User sessions table (stores only SHA-256 hash of opaque session token)
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 3. Favorites (saved recipes)
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_recipe_slug ON favorites(recipe_slug);

-- 4. Custom recipe collections
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_user_updated ON collections(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_public ON collections(is_public, updated_at DESC);

-- 5. Collection recipes (many-to-many join with duplicate prevention)
CREATE TABLE IF NOT EXISTS collection_recipes (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(collection_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_collection_recipes_collection ON collection_recipes(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_recipes_slug ON collection_recipes(recipe_slug);

-- 6. Recently viewed recipes (deduplicated per user + recipe)
CREATE TABLE IF NOT EXISTS recently_viewed (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_recently_viewed_user_time ON recently_viewed(user_id, viewed_at DESC);

-- 7. Recipe star ratings & reviews
-- Note: user_id uses ON DELETE SET NULL so approved community reviews can be retained
-- in anonymized form ("Deleted User") when an account is deleted per retention policy.
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_display_name TEXT NOT NULL DEFAULT 'Community Cook',
  author_username TEXT NOT NULL DEFAULT 'member',
  recipe_slug TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  moderated_by TEXT,
  moderated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_reviews_recipe_status ON reviews(recipe_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status_created ON reviews(status, created_at DESC);

-- 8. Email verification tokens (stores only SHA-256 token hash)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_verification_tokens(user_id);

-- 9. Password reset tokens (stores only SHA-256 token hash, single-use)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- 10. Non-PII compliance & moderation audit log
CREATE TABLE IF NOT EXISTS account_audit_log (
  id TEXT PRIMARY KEY,
  user_id_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_audit_created ON account_audit_log(created_at DESC);

