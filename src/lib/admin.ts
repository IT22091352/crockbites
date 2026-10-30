import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'crockbites_admin';
export const CSRF_COOKIE_NAME = 'crockbites_admin_csrf';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 9;
const RATE_LIMITS = new Map<string, { count: number; resetAt: number }>();

declare global {
  var __CROCKBITES_DEV_SESSION_SECRET__: string | undefined;
}

export interface CloudflareKvNamespace {
  get(key: string, type?: 'text' | 'json'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function getRuntimeSecret(name: string, fallback?: string) {
  const env = typeof import.meta !== 'undefined'
    ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
    : {};

  // Cloudflare Workers/Pages secrets are exposed through runtime bindings (see runtime-env.ts).
  const bindings = (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__;
  const bound = bindings?.[name];

  const candidates = [
    typeof bound === 'string' ? bound : undefined,
    typeof env[name] === 'string' ? env[name] : undefined,
    typeof process !== 'undefined' ? process.env?.[name] : undefined,
    fallback,
  ];

  let value = '';
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      value = c.trim();
      break;
    }
  }
  if (!value) return '';

  const unescaped = value.replace(/\\([\\$])/g, '$1');
  const first = unescaped[0];
  const last = unescaped[unescaped.length - 1];
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    return unescaped.slice(1, -1).trim();
  }

  return unescaped;
}

export function getAdminSessionSecret() {
  const configured = getRuntimeSecret('ADMIN_SESSION_SECRET');
  if (configured) return configured;

  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    globalThis.__CROCKBITES_DEV_SESSION_SECRET__ ??= randomBytes(32).toString('hex');
    return globalThis.__CROCKBITES_DEV_SESSION_SECRET__;
  }

  return '';
}

export function isAdminConfigured() {
  return Boolean(getRuntimeSecret('ADMIN_USERNAME') && getRuntimeSecret('ADMIN_PASSWORD_HASH') && getAdminSessionSecret());
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith('scrypt$')) return false;
  const [, salt, hashPart] = storedHash.split('$');
  if (!salt || !hashPart) return false;

  const derived = scryptSync(password, salt, 64).toString('hex');
  const expected = Buffer.from(hashPart, 'hex');
  const actual = Buffer.from(derived, 'hex');

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function generateSessionId() {
  return randomBytes(24).toString('hex');
}

/**
 * Derives an irreversible 16-hex version string from the current admin password hash or explicit session version.
 * If the admin password changes, the session version changes, immediately invalidating previously issued sessions.
 */
export function getSessionVersion(passwordHash?: string): string {
  const explicitVersion = getRuntimeSecret('ADMIN_SESSION_VERSION');
  if (explicitVersion) {
    return explicitVersion.slice(0, 16);
  }
  const hash = passwordHash || getRuntimeSecret('ADMIN_PASSWORD_HASH') || 'default-session-seed';
  return createHmac('sha256', 'cb_session_v').update(hash).digest('hex').slice(0, 16);
}

export function buildSessionCookie(username: string, secret: string, sessionVersion?: string) {
  const version = sessionVersion || getSessionVersion();
  const sessionId = generateSessionId();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload = `${sessionId}:${username}:${expiresAt}:${version}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${sessionId}.${username}.${expiresAt}.${version}.${signature}`;
}

export function parseAdminSessionCookie(cookieValue: string | undefined) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length === 5) {
    const [id, username, expiresAt, version, signature] = parts;
    if (!id || !username || !expiresAt || !version || !signature) return null;
    const expiration = Number(expiresAt);
    if (!Number.isFinite(expiration)) return null;
    return { id, username, expiresAt: expiration, version, signature };
  }
  if (parts.length === 4) {
    const [id, username, expiresAt, signature] = parts;
    if (!id || !username || !expiresAt || !signature) return null;
    const expiration = Number(expiresAt);
    if (!Number.isFinite(expiration)) return null;
    return { id, username, expiresAt: expiration, version: undefined, signature };
  }
  return null;
}

export function verifySessionCookie(
  cookieValue: string | undefined,
  secret: string,
  expectedVersion?: string,
): boolean {
  const parsed = parseAdminSessionCookie(cookieValue);
  if (!parsed) return false;
  if (Date.now() > parsed.expiresAt) return false;

  const currentExpectedVersion = expectedVersion ?? getSessionVersion();

  if (parsed.version) {
    if (parsed.version !== currentExpectedVersion) {
      return false; // Invalidate session when version / password hash changes
    }
    const payload = `${parsed.id}:${parsed.username}:${parsed.expiresAt}:${parsed.version}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const actual = Buffer.from(parsed.signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (actual.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actual, expectedBuffer);
  }

  // Legacy 4-part session format
  if (expectedVersion) {
    return false; // If a specific version is required, legacy unversioned cookies are rejected
  }
  const payload = `${parsed.id}:${parsed.username}:${parsed.expiresAt}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const actual = Buffer.from(parsed.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (actual.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actual, expectedBuffer);
}

export function createCsrfToken(secret: string, sessionId: string) {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('hex');
}

export async function ensureCsrfToken(
  request: Request,
  csrfCookieValue: string | undefined,
  secret: string,
  sessionId: string,
) {
  let token = request.headers.get('x-csrf-token') ?? undefined;

  if (!token) {
    const contentType = request.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const data = await request.clone().json();
        token = typeof data?.csrfToken === 'string' ? data.csrfToken : undefined;
      } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
        const data = await request.clone().formData();
        token = typeof data.get('csrfToken') === 'string' ? String(data.get('csrfToken')) : undefined;
      }
    } catch {
      token = undefined;
    }
  }

  const expected = createCsrfToken(secret, sessionId);
  return Boolean(csrfCookieValue && token && csrfCookieValue === token && token === expected);
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'recipe';
}

export function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function clearAdminCookies(cookies: { delete: (name: string, options?: { path?: string }) => void }) {
  cookies.delete(ADMIN_COOKIE_NAME, { path: '/' });
  cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
}

export function checkRateLimit(key: string, maxRequests = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const current = RATE_LIMITS.get(key);

  if (!current || current.resetAt <= now) {
    RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count += 1;
  return true;
}

// ---- Cloudflare KV & Login Rate Limiting ----

export function getKvNamespace(name = 'RATE_LIMIT_KV'): CloudflareKvNamespace | null {
  const bindings = (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__;
  const candidate = bindings?.[name] ?? bindings?.['SESSION'] ?? bindings?.['KV'];
  if (candidate && typeof (candidate as any).get === 'function' && typeof (candidate as any).put === 'function') {
    return candidate as CloudflareKvNamespace;
  }
  return null;
}

export function getRateLimitStorageInfo(): { isDistributed: boolean; bindingName: string; details: string } {
  const kv = getKvNamespace('RATE_LIMIT_KV');
  if (kv) {
    return {
      isDistributed: true,
      bindingName: 'RATE_LIMIT_KV',
      details: 'Cloudflare KV distributed rate limiting is active using binding "RATE_LIMIT_KV".',
    };
  }
  return {
    isDistributed: false,
    bindingName: 'RATE_LIMIT_KV',
    details: 'Cloudflare KV binding "RATE_LIMIT_KV" is not configured. Falling back to in-memory sliding-window rate limiting.',
  };
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    const trimmed = cfIp.trim();
    if (/^[0-9a-fA-F:.]+$/.test(trimmed)) {
      return trimmed;
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const trimmed = realIp.trim();
    if (/^[0-9a-fA-F:.]+$/.test(trimmed)) {
      return trimmed;
    }
  }

  return '127.0.0.1';
}

interface LoginRateLimitEntry {
  attempts: number;
  lockUntil: number;
  firstAttemptAt: number;
}

const IN_MEMORY_LOGIN_LIMITS = new Map<string, LoginRateLimitEntry>();

async function getLoginLimitEntry(key: string): Promise<LoginRateLimitEntry | null> {
  const kv = getKvNamespace('RATE_LIMIT_KV');
  if (kv) {
    try {
      const data = await kv.get(`cbrl:${key}`);
      if (data) {
        return JSON.parse(data) as LoginRateLimitEntry;
      }
    } catch {
      // In case of KV read error, fall back to in-memory
    }
  }
  return IN_MEMORY_LOGIN_LIMITS.get(key) ?? null;
}

async function setLoginLimitEntry(key: string, entry: LoginRateLimitEntry, ttlSeconds: number): Promise<void> {
  IN_MEMORY_LOGIN_LIMITS.set(key, entry);
  const kv = getKvNamespace('RATE_LIMIT_KV');
  if (kv) {
    try {
      await kv.put(`cbrl:${key}`, JSON.stringify(entry), {
        expirationTtl: Math.max(60, ttlSeconds),
      });
    } catch {
      // Non-fatal if KV put fails
    }
  }
}

async function deleteLoginLimitEntry(key: string): Promise<void> {
  IN_MEMORY_LOGIN_LIMITS.delete(key);
  const kv = getKvNamespace('RATE_LIMIT_KV');
  if (kv) {
    try {
      await kv.delete(`cbrl:${key}`);
    } catch {
      // Non-fatal
    }
  }
}

export async function checkLoginRateLimit(
  ip: string,
  username: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number; lockedBy: 'ip' | 'account' | null }> {
  const now = Date.now();
  const safeIp = ip.replace(/[^a-zA-Z0-9:.]/g, '');
  const safeUser = (username || 'unknown').toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '');

  const ipKey = `ip:${safeIp}`;
  const userKey = safeUser ? `user:${safeUser}` : null;

  const [ipEntry, userEntry] = await Promise.all([
    getLoginLimitEntry(ipKey),
    userKey ? getLoginLimitEntry(userKey) : Promise.resolve(null),
  ]);

  if (ipEntry && ipEntry.lockUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((ipEntry.lockUntil - now) / 1000));
    return { allowed: false, retryAfterSeconds, lockedBy: 'ip' };
  }

  if (userEntry && userEntry.lockUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((userEntry.lockUntil - now) / 1000));
    return { allowed: false, retryAfterSeconds, lockedBy: 'account' };
  }

  return { allowed: true, retryAfterSeconds: 0, lockedBy: null };
}

export async function recordFailedLogin(
  ip: string,
  username: string,
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const safeIp = ip.replace(/[^a-zA-Z0-9:.]/g, '');
  const safeUser = (username || 'unknown').toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '');

  const keys = [`ip:${safeIp}`];
  if (safeUser) keys.push(`user:${safeUser}`);

  let isNowLocked = false;
  let maxRetryAfterSeconds = 0;

  for (const key of keys) {
    let entry = await getLoginLimitEntry(key);
    if (!entry || (entry.lockUntil <= now && now - entry.firstAttemptAt > LOGIN_LOCKOUT_WINDOW_SECONDS * 1000)) {
      entry = { attempts: 1, lockUntil: 0, firstAttemptAt: now };
    } else {
      entry.attempts += 1;
    }

    if (entry.attempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
      entry.lockUntil = now + LOGIN_LOCKOUT_WINDOW_SECONDS * 1000;
      isNowLocked = true;
      const retryAfter = Math.max(1, Math.ceil((entry.lockUntil - now) / 1000));
      if (retryAfter > maxRetryAfterSeconds) {
        maxRetryAfterSeconds = retryAfter;
      }
    }

    const ttl = isNowLocked
      ? LOGIN_LOCKOUT_WINDOW_SECONDS
      : Math.max(60, Math.ceil((entry.firstAttemptAt + LOGIN_LOCKOUT_WINDOW_SECONDS * 1000 - now) / 1000));
    await setLoginLimitEntry(key, entry, ttl);
  }

  return { locked: isNowLocked, retryAfterSeconds: maxRetryAfterSeconds };
}

export async function resetLoginRateLimit(ip: string, username: string): Promise<void> {
  const safeIp = ip.replace(/[^a-zA-Z0-9:.]/g, '');
  const safeUser = (username || 'unknown').toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '');

  await Promise.all([
    deleteLoginLimitEntry(`ip:${safeIp}`),
    safeUser ? deleteLoginLimitEntry(`user:${safeUser}`) : Promise.resolve(),
  ]);
}
