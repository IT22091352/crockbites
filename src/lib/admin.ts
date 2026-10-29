import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'crockbites_admin';
export const CSRF_COOKIE_NAME = 'crockbites_admin_csrf';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 9;
const RATE_LIMITS = new Map<string, { count: number; resetAt: number }>();

declare global {
  var __CROCKBITES_DEV_SESSION_SECRET__: string | undefined;
}

export function getRuntimeSecret(name: string, fallback?: string) {
  const env = typeof import.meta !== 'undefined'
    ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
    : {};

  // Cloudflare Workers/Pages secrets are only reachable through the runtime bindings (see runtime-env.ts).
  const bindings = (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__;
  const bound = bindings?.[name];

  const candidate = env[name] ?? (typeof bound === 'string' ? bound : undefined) ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined) ?? fallback ?? '';
  const value = typeof candidate === 'string' ? candidate.trim() : '';
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

export function buildSessionCookie(username: string, secret: string) {
  const sessionId = generateSessionId();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload = `${sessionId}:${username}:${expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${sessionId}.${username}.${expiresAt}.${signature}`;
}

export function parseAdminSessionCookie(cookieValue: string | undefined) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 4) return null;

  const [id, username, expiresAt, signature] = parts;
  if (!id || !username || !expiresAt || !signature) return null;

  const expiration = Number(expiresAt);
  if (!Number.isFinite(expiration)) return null;

  return { id, username, expiresAt: expiration, signature };
}

export function verifySessionCookie(cookieValue: string | undefined, secret: string) {
  const parsed = parseAdminSessionCookie(cookieValue);
  if (!parsed) return false;
  if (Date.now() > parsed.expiresAt) return false;

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
