/**
 * Cloudflare D1 Database Layer for CrockBites Community Platform.
 *
 * - Production: Uses the Cloudflare D1 binding `DB` (or `CROCKBITES_DB`).
 * - Local Dev / Automated Tests: Supports an isolated D1-compatible SQLite adapter
 *   powered by Node's built-in `node:sqlite` so all parameterized SQL, foreign keys,
 *   unique constraints, and cascades execute identically.
 * - Never claims production D1 is active when the `DB` binding is missing.
 */

import { loadRuntimeEnv } from './runtime-env.ts';

export interface D1Meta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  changed_db?: boolean;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

declare global {
  var __CROCKBITES_TEST_D1__: D1Database | undefined;
  var __CROCKBITES_LOCAL_D1__: D1Database | undefined;
  var __CROCKBITES_SCHEMA_INITIALIZED__: WeakSet<object> | undefined;
}

export const COMMUNITY_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_recipe_slug ON favorites(recipe_slug);

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

CREATE TABLE IF NOT EXISTS collection_recipes (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(collection_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_collection_recipes_collection ON collection_recipes(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_recipes_slug ON collection_recipes(recipe_slug);

CREATE TABLE IF NOT EXISTS recently_viewed (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_recently_viewed_user_time ON recently_viewed(user_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_display_name TEXT NOT NULL DEFAULT 'Community Cook',
  author_username TEXT NOT NULL DEFAULT 'member',
  recipe_slug TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  moderated_by TEXT,
  moderated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, recipe_slug)
);

CREATE INDEX IF NOT EXISTS idx_reviews_recipe_status ON reviews(recipe_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status_created ON reviews(status, created_at DESC);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS account_audit_log (
  id TEXT PRIMARY KEY,
  user_id_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_audit_created ON account_audit_log(created_at DESC);
`;

function isD1Instance(candidate: unknown): candidate is D1Database {
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as D1Database).prepare === 'function',
  );
}

/**
 * Wraps a Node.js `node:sqlite` DatabaseSync instance in the Cloudflare D1Database interface.
 * Used exclusively in local development and automated tests.
 */
export function createSqliteD1Adapter(sqliteDb: any): D1Database {
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  const createStatement = (sql: string, boundValues: unknown[] = []): D1PreparedStatement => {
    const normalizeParam = (v: unknown) => {
      if (v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    };

    return {
      bind(...values: unknown[]) {
        return createStatement(sql, values.map(normalizeParam));
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const stmt = sqliteDb.prepare(sql);
        const row = stmt.get(...boundValues);
        if (!row) return null;
        const plain = { ...row };
        if (colName) {
          return (plain[colName] ?? null) as T | null;
        }
        return plain as T;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const stmt = sqliteDb.prepare(sql);
        const rows = stmt.all(...boundValues).map((r: any) => ({ ...r }));
        return {
          results: rows as T[],
          success: true,
          meta: { duration: 0, changes: 0 },
        };
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const stmt = sqliteDb.prepare(sql);
        const info = stmt.run(...boundValues);
        return {
          results: [],
          success: true,
          meta: {
            duration: 0,
            changes: Number(info?.changes ?? 0),
            last_row_id: Number(info?.lastInsertRowid ?? 0),
            changed_db: Number(info?.changes ?? 0) > 0,
          },
        };
      },
    };
  };

  return {
    prepare(query: string) {
      return createStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        results.push(await stmt.run<T>());
      }
      return results;
    },
    async exec(query: string) {
      sqliteDb.exec(query);
      return { count: 1, duration: 0 };
    },
  };
}

export function getCloudflareD1Binding(_locals?: any): D1Database | null {
  // In Astro v6+/v7 (@astrojs/cloudflare v14), bindings are exposed via `import { env } from "cloudflare:workers"`,
  // which `loadRuntimeEnv()` stores on `globalThis.__CROCKBITES_ENV__`.
  // Never access `locals.runtime.env` as @astrojs/cloudflare defines a throwing getter on `locals.runtime.env`.
  const globalEnv = (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__;
  if (globalEnv) {
    if (isD1Instance(globalEnv.DB)) return globalEnv.DB;
    if (isD1Instance(globalEnv.CROCKBITES_DB)) return globalEnv.CROCKBITES_DB;
  }

  return null;
}

export function getD1BindingStatus(locals?: any): {
  isD1Bound: boolean;
  bindingName: string;
  mode: 'cloudflare-d1' | 'local-sqlite' | 'unconfigured';
  details: string;
} {
  const cfD1 = getCloudflareD1Binding(locals);
  if (cfD1) {
    return {
      isD1Bound: true,
      bindingName: 'DB',
      mode: 'cloudflare-d1',
      details: 'Cloudflare D1 database binding "DB" is active.',
    };
  }

  if (globalThis.__CROCKBITES_TEST_D1__ || globalThis.__CROCKBITES_LOCAL_D1__) {
    return {
      isD1Bound: false,
      bindingName: 'DB',
      mode: 'local-sqlite',
      details: 'Cloudflare D1 binding "DB" is not configured in Cloudflare; running with local SQLite development adapter.',
    };
  }

  return {
    isD1Bound: false,
    bindingName: 'DB',
    mode: 'unconfigured',
    details: 'Cloudflare D1 binding "DB" is not configured. Add a D1 database binding named "DB" in Cloudflare Pages Settings -> Functions -> D1 database bindings.',
  };
}

async function getOrInitLocalDevD1(): Promise<D1Database | null> {
  if (globalThis.__CROCKBITES_TEST_D1__) {
    return globalThis.__CROCKBITES_TEST_D1__;
  }
  if (globalThis.__CROCKBITES_LOCAL_D1__) {
    return globalThis.__CROCKBITES_LOCAL_D1__;
  }

  const isDev =
    (typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)) ||
    (typeof process !== 'undefined' && process.env?.CROCKBITES_LOCAL_SQLITE === '1');

  if (!isDev) {
    return null;
  }

  try {
    // Dynamic import via Function constructor so Vite/Rollup never bundles node:sqlite into Cloudflare Worker output
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const sqliteMod = await dynamicImport('node:sqlite');
    const fsMod = await dynamicImport('node:fs');
    const pathMod = await dynamicImport('node:path');

    const dbDir = pathMod.resolve('.wrangler/state');
    if (!fsMod.existsSync(dbDir)) {
      fsMod.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = pathMod.join(dbDir, 'local-community-d1.sqlite');
    const rawDb = new sqliteMod.DatabaseSync(dbPath);
    const adapter = createSqliteD1Adapter(rawDb);
    await ensureCommunitySchema(adapter);
    globalThis.__CROCKBITES_LOCAL_D1__ = adapter;
    return adapter;
  } catch {
    return null;
  }
}

export async function ensureCommunitySchema(db: D1Database): Promise<void> {
  globalThis.__CROCKBITES_SCHEMA_INITIALIZED__ ??= new WeakSet<object>();
  if (globalThis.__CROCKBITES_SCHEMA_INITIALIZED__.has(db as unknown as object)) {
    return;
  }

  try {
    const rawStatements = COMMUNITY_SCHEMA_SQL
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const pragmaStatements = rawStatements.filter((s) => /^PRAGMA\b/i.test(s));
    const ddlStatements = rawStatements.filter((s) => !/^PRAGMA\b/i.test(s));

    for (const pragma of pragmaStatements) {
      try {
        await db.prepare(pragma).run();
      } catch {
        // Cloudflare D1 manages foreign_keys automatically and may ignore PRAGMA in prepared statements
      }
    }

    if (typeof db.batch === 'function' && ddlStatements.length > 0) {
      try {
        await db.batch(ddlStatements.map((stmt) => db.prepare(stmt)));
        globalThis.__CROCKBITES_SCHEMA_INITIALIZED__.add(db as unknown as object);
        return;
      } catch {
        // Fallback to sequential execution if batch fails
      }
    }

    for (const stmt of ddlStatements) {
      try {
        await db.prepare(stmt).run();
      } catch (stmtErr) {
        console.error('[CrockBites D1 Diagnostic] Schema statement failed:', {
          stage: 'ensureCommunitySchema',
          statementPrefix: stmt.slice(0, 60),
          error: stmtErr instanceof Error ? stmtErr.message : String(stmtErr),
        });
      }
    }
    globalThis.__CROCKBITES_SCHEMA_INITIALIZED__.add(db as unknown as object);
  } catch (err) {
    console.error('[CrockBites D1 Diagnostic] Schema initialization error:', {
      stage: 'ensureCommunitySchema',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getDb(locals?: any): Promise<D1Database | null> {
  if (globalThis.__CROCKBITES_TEST_D1__) {
    await ensureCommunitySchema(globalThis.__CROCKBITES_TEST_D1__);
    return globalThis.__CROCKBITES_TEST_D1__;
  }

  await loadRuntimeEnv();

  const cfD1 = getCloudflareD1Binding(locals);
  if (cfD1) {
    await ensureCommunitySchema(cfD1);
    return cfD1;
  }

  return getOrInitLocalDevD1();
}

