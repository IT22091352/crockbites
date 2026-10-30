import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { D1Database } from './db.ts';
import { getKvNamespace, getRuntimeSecret } from './admin.ts';

export const USER_SESSION_COOKIE = 'crockbites_user_session';
export const USER_CSRF_COOKIE = 'crockbites_user_csrf';

export const USER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days default
export const USER_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days with Remember Me
export const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60; // 30 minutes

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'moderator',
  'mod',
  'crockbites',
  'official',
  'staff',
  'api',
  'login',
  'logout',
  'register',
  'account',
  'profile',
  'settings',
  'deleted',
]);

export interface SafeUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  role: 'user' | 'moderator';
  emailVerified: boolean;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

declare global {
  var __CROCKBITES_USER_DEV_SECRET__: string | undefined;
}

export function escapeHtml(input: unknown): string {
  const str = typeof input === 'string' ? input : String(input ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizePlainText(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return escapeHtml(input.trim().replace(/\r\n/g, '\n').slice(0, maxLength));
}

export function sanitizeReturnUrl(returnTo: unknown, fallback = '/account/'): string {
  if (typeof returnTo !== 'string') return fallback;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }
  // Never redirect normal user login flows into admin routes
  if (trimmed.startsWith('/admin') || trimmed.startsWith('/api/')) {
    return fallback;
  }
  return trimmed;
}

export function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function hashUserPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt_u1$${salt}$${derived}`;
}

export function verifyUserPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt_u1$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const derivedHex = scryptSync(password, salt, 64).toString('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = Buffer.from(derivedHex, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

const DUMMY_PASSWORD_HASH = hashUserPassword('crockbites_constant_time_dummy_pass_99');

export function performDummyPasswordVerify(password: string): void {
  verifyUserPassword(password, DUMMY_PASSWORD_HASH);
}

// ---- Validation ----

export function validateUsername(username: unknown): { valid: boolean; normalized: string; error?: string } {
  const raw = typeof username === 'string' ? username.trim() : '';
  const normalized = raw.toLowerCase();
  if (raw.length < 3 || raw.length > 24) {
    return { valid: false, normalized, error: 'Username must be between 3 and 24 characters.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(raw)) {
    return { valid: false, normalized, error: 'Username can only contain letters, numbers, and underscores.' };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return { valid: false, normalized, error: 'This username is reserved. Please choose another.' };
  }
  return { valid: true, normalized };
}

export function validateEmail(email: unknown): { valid: boolean; normalized: string; error?: string } {
  const raw = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!raw || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) {
    return { valid: false, normalized: raw, error: 'Please enter a valid email address.' };
  }
  return { valid: true, normalized: raw };
}

export function validatePasswordStrength(password: unknown): { valid: boolean; error?: string } {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters.' };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one letter and one number.' };
  }
  return { valid: true };
}

export function validateDisplayName(displayName: unknown): { valid: boolean; sanitized: string; error?: string } {
  const raw = typeof displayName === 'string' ? displayName.trim().replace(/\s+/g, ' ') : '';
  if (raw.length < 2 || raw.length > 50) {
    return { valid: false, sanitized: '', error: 'Display name must be between 2 and 50 characters.' };
  }
  return { valid: true, sanitized: escapeHtml(raw) };
}

// ---- User CSRF Protection (Isolated from Admin CSRF) ----

export function getUserCsrfSecret(): string {
  const explicit = getRuntimeSecret('USER_SESSION_SECRET');
  if (explicit) return explicit;

  const adminSecret = getRuntimeSecret('ADMIN_SESSION_SECRET');
  if (adminSecret) {
    return createHmac('sha256', adminSecret).update('crockbites_user_csrf_domain_separation_v1').digest('hex');
  }

  globalThis.__CROCKBITES_USER_DEV_SECRET__ ??= randomBytes(32).toString('hex');
  return globalThis.__CROCKBITES_USER_DEV_SECRET__;
}

export function createUserCsrfToken(sessionTokenOrContext = 'guest'): string {
  const secret = getUserCsrfSecret();
  const contextHash = hashToken(sessionTokenOrContext).slice(0, 24);
  return createHmac('sha256', secret).update(`user_csrf:${contextHash}`).digest('hex');
}

export async function verifyUserCsrfToken(
  request: Request,
  csrfCookieValue: string | undefined,
  sessionTokenOrContext = 'guest',
): Promise<boolean> {
  if (!csrfCookieValue) return false;

  let submittedToken = request.headers.get('x-csrf-token') ?? undefined;
  if (!submittedToken) {
    const contentType = request.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const body = await request.clone().json();
        submittedToken = typeof body?.csrfToken === 'string' ? body.csrfToken : undefined;
      } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const form = await request.clone().formData();
        const val = form.get('csrfToken');
        submittedToken = typeof val === 'string' ? val : undefined;
      }
    } catch {
      submittedToken = undefined;
    }
  }

  if (!submittedToken) return false;
  const expected = createUserCsrfToken(sessionTokenOrContext);

  const a = Buffer.from(submittedToken);
  const b = Buffer.from(expected);
  const c = Buffer.from(csrfCookieValue);
  if (a.length !== b.length || a.length !== c.length) return false;
  return timingSafeEqual(a, b) && timingSafeEqual(a, c);
}

export function setUserAuthCookies(
  cookies: any,
  sessionToken: string,
  maxAgeSeconds: number,
  isHttps: boolean,
): string {
  const csrfToken = createUserCsrfToken(sessionToken);
  cookies.set(USER_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: maxAgeSeconds,
  });
  cookies.set(USER_CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: maxAgeSeconds,
  });
  return csrfToken;
}

export function clearUserAuthCookies(cookies: any): void {
  cookies.delete(USER_SESSION_COOKIE, { path: '/' });
  cookies.delete(USER_CSRF_COOKIE, { path: '/' });
}

// ---- Rate Limiting for User Actions ----

interface UserRateBucket {
  count: number;
  resetAt: number;
}

const USER_RATE_LIMITS = new Map<string, UserRateBucket>();

export async function checkUserRateLimit(
  namespace: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const safeId = identifier.toLowerCase().trim().replace(/[^a-z0-9:._-]/g, '').slice(0, 80) || 'anon';
  const key = `u_rl:${namespace}:${safeId}`;

  const kv = getKvNamespace('RATE_LIMIT_KV');
  if (kv) {
    try {
      const raw = await kv.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as UserRateBucket;
        if (entry.resetAt > now) {
          if (entry.count >= maxRequests) {
            return {
              allowed: false,
              retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
            };
          }
          entry.count += 1;
          await kv.put(key, JSON.stringify(entry), {
            expirationTtl: Math.max(60, Math.ceil((entry.resetAt - now) / 1000)),
          });
          return { allowed: true, retryAfterSeconds: 0 };
        }
      }
      const fresh: UserRateBucket = { count: 1, resetAt: now + windowSeconds * 1000 };
      await kv.put(key, JSON.stringify(fresh), { expirationTtl: Math.max(60, windowSeconds) });
      return { allowed: true, retryAfterSeconds: 0 };
    } catch {
      // Fallback to in-memory on KV failure
    }
  }

  const existing = USER_RATE_LIMITS.get(key);
  if (!existing || existing.resetAt <= now) {
    USER_RATE_LIMITS.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetUserRateLimitsForTest(): void {
  USER_RATE_LIMITS.clear();
}

// ---- Row Mapper ----

function mapRowToSafeUser(row: Record<string, unknown>): SafeUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    displayName: String(row.display_name),
    avatarUrl: String(row.avatar_url ?? ''),
    bio: String(row.bio ?? ''),
    role: row.role === 'moderator' ? 'moderator' : 'user',
    emailVerified: Number(row.email_verified) === 1,
    status: (row.status as SafeUser['status']) || 'active',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

// ---- Core User & Session Database Operations ----

export async function createSessionForUser(
  db: D1Database,
  userId: string,
  ttlSeconds = USER_SESSION_TTL_SECONDS,
): Promise<{ sessionToken: string; expiresAt: string; maxAgeSeconds: number }> {
  const sessionId = generateId();
  const sessionToken = generateOpaqueToken(32);
  const tokenHash = hashToken(sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const nowIso = now.toISOString();

  await db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at, created_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, userId, tokenHash, expiresAt, nowIso, nowIso)
    .run();

  return { sessionToken, expiresAt, maxAgeSeconds: ttlSeconds };
}

export async function registerUser(
  db: D1Database,
  input: {
    username: unknown;
    email: unknown;
    displayName: unknown;
    password: unknown;
    confirmPassword?: unknown;
    termsAccepted?: unknown;
  },
): Promise<{ ok: true; user: SafeUser; sessionToken: string; maxAgeSeconds: number } | { ok: false; error: string }> {
  const uCheck = validateUsername(input.username);
  if (!uCheck.valid) return { ok: false, error: uCheck.error! };

  const eCheck = validateEmail(input.email);
  if (!eCheck.valid) return { ok: false, error: eCheck.error! };

  const dCheck = validateDisplayName(input.displayName || input.username);
  if (!dCheck.valid) return { ok: false, error: dCheck.error! };

  const pCheck = validatePasswordStrength(input.password);
  if (!pCheck.valid) return { ok: false, error: pCheck.error! };

  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  if (input.termsAccepted !== undefined && !input.termsAccepted) {
    return { ok: false, error: 'You must accept the Terms of Use and Privacy Policy to create an account.' };
  }

  const existing = await db
    .prepare(`SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1`)
    .bind(uCheck.normalized, eCheck.normalized)
    .first<{ id: string; username: string; email: string }>();

  if (existing) {
    if (existing.username.toLowerCase() === uCheck.normalized) {
      return { ok: false, error: 'That username is already taken. Please choose another.' };
    }
    return { ok: false, error: 'Unable to complete registration with the provided details. Please sign in or try another email.' };
  }

  const userId = generateId();
  const passwordHash = hashUserPassword(String(input.password));
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, display_name, avatar_url, bio, role, email_verified, status, session_version, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, '', '', 'user', 0, 'active', 1, ?, ?, ?)`,
    )
    .bind(userId, uCheck.normalized, eCheck.normalized, passwordHash, dCheck.sanitized, nowIso, nowIso, nowIso)
    .run();

  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  if (!row) {
    return { ok: false, error: 'Failed to create user account.' };
  }

  const session = await createSessionForUser(db, userId, USER_SESSION_TTL_SECONDS);
  return {
    ok: true,
    user: mapRowToSafeUser(row),
    sessionToken: session.sessionToken,
    maxAgeSeconds: session.maxAgeSeconds,
  };
}

export async function authenticateUser(
  db: D1Database,
  identifier: unknown,
  password: unknown,
  rememberMe = false,
): Promise<{ ok: true; user: SafeUser; sessionToken: string; maxAgeSeconds: number } | { ok: false; error: string }> {
  const cleanId = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  const cleanPass = typeof password === 'string' ? password : '';

  if (!cleanId || !cleanPass) {
    return { ok: false, error: 'Please enter your email or username and password.' };
  }

  const row = await db
    .prepare(`SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1`)
    .bind(cleanId, cleanId)
    .first<Record<string, unknown>>();

  if (!row) {
    performDummyPasswordVerify(cleanPass);
    return { ok: false, error: 'Invalid email/username or password.' };
  }

  const passwordValid = verifyUserPassword(cleanPass, String(row.password_hash ?? ''));
  if (!passwordValid) {
    return { ok: false, error: 'Invalid email/username or password.' };
  }

  if (row.status !== 'active') {
    return { ok: false, error: 'This account is no longer active.' };
  }

  const nowIso = new Date().toISOString();
  const userId = String(row.id);

  await db
    .prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowIso, nowIso, userId)
    .run();

  const ttl = rememberMe ? USER_REMEMBER_TTL_SECONDS : USER_SESSION_TTL_SECONDS;
  const session = await createSessionForUser(db, userId, ttl);

  row.last_login_at = nowIso;
  return {
    ok: true,
    user: mapRowToSafeUser(row),
    sessionToken: session.sessionToken,
    maxAgeSeconds: session.maxAgeSeconds,
  };
}

export async function getAuthenticatedUser(
  db: D1Database | null,
  sessionToken: string | undefined,
): Promise<SafeUser | null> {
  if (!db || !sessionToken || sessionToken.length < 32) return null;

  const tokenHash = hashToken(sessionToken);
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires_at
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const expiresAt = String(row.session_expires_at ?? '');
  if (!expiresAt || expiresAt <= nowIso || row.status !== 'active') {
    await db.prepare(`DELETE FROM user_sessions WHERE session_token_hash = ?`).bind(tokenHash).run();
    return null;
  }

  await db
    .prepare(`UPDATE user_sessions SET last_activity_at = ? WHERE id = ?`)
    .bind(nowIso, String(row.session_id))
    .run();

  return mapRowToSafeUser(row);
}

export async function revokeUserSession(db: D1Database, sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;
  const tokenHash = hashToken(sessionToken);
  await db.prepare(`DELETE FROM user_sessions WHERE session_token_hash = ?`).bind(tokenHash).run();
}

export async function revokeAllUserSessions(db: D1Database, userId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId).run();
  await db
    .prepare(`UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?`)
    .bind(nowIso, userId)
    .run();
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  updates: {
    displayName?: unknown;
    username?: unknown;
    bio?: unknown;
    avatarUrl?: unknown;
  },
): Promise<{ ok: true; user: SafeUser } | { ok: false; error: string }> {
  const current = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<Record<string, unknown>>();
  if (!current || current.status !== 'active') {
    return { ok: false, error: 'Account not found.' };
  }

  let newUsername = String(current.username);
  if (updates.username !== undefined && String(updates.username).trim().toLowerCase() !== newUsername) {
    const uCheck = validateUsername(updates.username);
    if (!uCheck.valid) return { ok: false, error: uCheck.error! };

    const conflict = await db
      .prepare(`SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1`)
      .bind(uCheck.normalized, userId)
      .first();
    if (conflict) {
      return { ok: false, error: 'That username is already in use.' };
    }
    newUsername = uCheck.normalized;
  }

  let newDisplayName = String(current.display_name);
  if (updates.displayName !== undefined) {
    const dCheck = validateDisplayName(updates.displayName);
    if (!dCheck.valid) return { ok: false, error: dCheck.error! };
    newDisplayName = dCheck.sanitized;
  }

  const newBio = updates.bio !== undefined ? sanitizePlainText(updates.bio, 300) : String(current.bio ?? '');

  let newAvatarUrl = String(current.avatar_url ?? '');
  if (updates.avatarUrl !== undefined) {
    const rawAvatar = typeof updates.avatarUrl === 'string' ? updates.avatarUrl.trim() : '';
    if (rawAvatar === '') {
      newAvatarUrl = '';
    } else if (
      rawAvatar.startsWith('https://res.cloudinary.com/') ||
      rawAvatar.startsWith('/avatars/') ||
      /^preset:[a-z0-9-]+$/.test(rawAvatar)
    ) {
      newAvatarUrl = rawAvatar.slice(0, 300);
    } else {
      return { ok: false, error: 'Avatar must be a preset CrockBites badge or a verified Cloudinary image.' };
    }
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE users
       SET username = ?, display_name = ?, bio = ?, avatar_url = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(newUsername, newDisplayName, newBio, newAvatarUrl, nowIso, userId)
    .run();

  // Keep denormalized author fields on active user's reviews in sync
  await db
    .prepare(`UPDATE reviews SET author_display_name = ?, author_username = ? WHERE user_id = ?`)
    .bind(newDisplayName, newUsername, userId)
    .run();

  const updated = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<Record<string, unknown>>();
  return { ok: true, user: mapRowToSafeUser(updated!) };
}

export async function changeUserPassword(
  db: D1Database,
  userId: string,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<{ ok: true; sessionToken: string; maxAgeSeconds: number } | { ok: false; error: string }> {
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<Record<string, unknown>>();
  if (!row || row.status !== 'active') {
    return { ok: false, error: 'Account not found.' };
  }

  if (typeof currentPassword !== 'string' || !verifyUserPassword(currentPassword, String(row.password_hash))) {
    return { ok: false, error: 'Your current password is incorrect.' };
  }

  const pCheck = validatePasswordStrength(newPassword);
  if (!pCheck.valid) return { ok: false, error: pCheck.error! };

  const newHash = hashUserPassword(String(newPassword));
  const nowIso = new Date().toISOString();

  await db
    .prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?`)
    .bind(newHash, nowIso, userId)
    .run();

  // Revoke all previous sessions and issue a fresh rotated session
  await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId).run();
  const freshSession = await createSessionForUser(db, userId, USER_SESSION_TTL_SECONDS);

  return {
    ok: true,
    sessionToken: freshSession.sessionToken,
    maxAgeSeconds: freshSession.maxAgeSeconds,
  };
}

/**
 * Deletes a user account according to CrockBites Data Retention & Privacy Policy:
 * - Immediately deletes sessions, saved favorites, private/public collections, collection items,
 *   recently viewed history, verification tokens, password reset tokens, and unapproved reviews.
 * - Retains approved community reviews in anonymized form (`user_id = NULL`, `author_display_name = 'Deleted User'`)
 *   so recipe ratings and moderated community discussions remain intact without personal data.
 * - Logs a non-reversible SHA-256 hash of the user ID in `account_audit_log` for moderation/compliance integrity.
 */
export async function deleteUserAccount(
  db: D1Database,
  userId: string,
  passwordConfirmation: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<Record<string, unknown>>();
  if (!row) {
    return { ok: false, error: 'Account not found.' };
  }

  if (typeof passwordConfirmation !== 'string' || !verifyUserPassword(passwordConfirmation, String(row.password_hash))) {
    return { ok: false, error: 'Password confirmation failed. Please enter your current password.' };
  }

  const nowIso = new Date().toISOString();
  const userIdHash = hashToken(`deleted_user:${userId}`);

  // 1. Delete unapproved (pending/rejected) reviews by this user
  await db.prepare(`DELETE FROM reviews WHERE user_id = ? AND status != 'approved'`).bind(userId).run();

  // 2. Anonymize approved reviews so no PII remains
  await db
    .prepare(
      `UPDATE reviews
       SET user_id = NULL, author_display_name = 'Deleted User', author_username = 'deleted', updated_at = ?
       WHERE user_id = ? AND status = 'approved'`,
    )
    .bind(nowIso, userId)
    .run();

  // 3. Delete all user-owned collections, favorites, recently viewed, sessions, tokens
  await db.prepare(`DELETE FROM favorites WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`DELETE FROM collections WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`DELETE FROM recently_viewed WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`DELETE FROM email_verification_tokens WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`).bind(userId).run();

  // 4. Record non-PII compliance audit event
  await db
    .prepare(
      `INSERT INTO account_audit_log (id, user_id_hash, event_type, details, created_at)
       VALUES (?, ?, 'account_deleted', 'User requested account deletion; PII purged and approved reviews anonymized.', ?)`,
    )
    .bind(generateId(), userIdHash, nowIso)
    .run();

  // 5. Remove user record
  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();

  return { ok: true };
}

// ---- Email Verification & Password Recovery Token Workflows ----

export function isTransactionalEmailConfigured(): { configured: boolean; provider: string; details: string } {
  const resendKey = getRuntimeSecret('RESEND_API_KEY');
  const emailFrom = getRuntimeSecret('EMAIL_FROM');
  if (resendKey && emailFrom) {
    return {
      configured: true,
      provider: 'Resend',
      details: 'Transactional email delivery is configured via RESEND_API_KEY and EMAIL_FROM.',
    };
  }
  return {
    configured: false,
    provider: 'unconfigured',
    details: 'Transactional email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM in Cloudflare Pages secrets before enabling live email delivery.',
  };
}

export async function createEmailVerificationToken(
  db: D1Database,
  userId: string,
): Promise<{ rawToken: string; expiresAt: string; emailDeliveryConfigured: boolean }> {
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_SECONDS * 1000).toISOString();

  // Invalidate prior unused tokens for this user
  await db
    .prepare(`DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL`)
    .bind(userId)
    .run();

  await db
    .prepare(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(generateId(), userId, tokenHash, expiresAt, now.toISOString())
    .run();

  return {
    rawToken,
    expiresAt,
    emailDeliveryConfigured: isTransactionalEmailConfigured().configured,
  };
}

export async function confirmEmailVerificationToken(
  db: D1Database,
  rawToken: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof rawToken !== 'string' || rawToken.length < 32) {
    return { ok: false, error: 'Invalid verification token.' };
  }

  const tokenHash = hashToken(rawToken.trim());
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();

  if (!row || row.used_at || row.expires_at <= nowIso) {
    return { ok: false, error: 'This verification link is invalid or has expired.' };
  }

  await db
    .prepare(`UPDATE email_verification_tokens SET used_at = ? WHERE id = ?`)
    .bind(nowIso, row.id)
    .run();

  await db
    .prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`)
    .bind(nowIso, row.user_id)
    .run();

  return { ok: true };
}

export async function createPasswordResetRequest(
  db: D1Database,
  emailInput: unknown,
): Promise<{
  ok: true;
  message: string;
  emailDeliveryConfigured: boolean;
  /** Returned only to internal caller/tests; never expose rawToken in public HTTP responses! */
  _internalRawToken?: string;
}> {
  const emailStatus = isTransactionalEmailConfigured();
  const genericMessage =
    'If an account matches that email address, password reset instructions have been prepared.';

  const eCheck = validateEmail(emailInput);
  if (!eCheck.valid) {
    return { ok: true, message: genericMessage, emailDeliveryConfigured: emailStatus.configured };
  }

  const user = await db
    .prepare(`SELECT id, status FROM users WHERE email = ? LIMIT 1`)
    .bind(eCheck.normalized)
    .first<{ id: string; status: string }>();

  if (!user || user.status !== 'active') {
    return { ok: true, message: genericMessage, emailDeliveryConfigured: emailStatus.configured };
  }

  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(`DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL`)
    .bind(user.id)
    .run();

  await db
    .prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(generateId(), user.id, tokenHash, expiresAt, now.toISOString())
    .run();

  return {
    ok: true,
    message: genericMessage,
    emailDeliveryConfigured: emailStatus.configured,
    _internalRawToken: rawToken,
  };
}

export async function confirmPasswordResetToken(
  db: D1Database,
  rawToken: unknown,
  newPassword: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof rawToken !== 'string' || rawToken.length < 32) {
    return { ok: false, error: 'Invalid or expired password reset token.' };
  }

  const pCheck = validatePasswordStrength(newPassword);
  if (!pCheck.valid) return { ok: false, error: pCheck.error! };

  const tokenHash = hashToken(rawToken.trim());
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();

  if (!row || row.used_at || row.expires_at <= nowIso) {
    return { ok: false, error: 'This password reset link is invalid, already used, or expired.' };
  }

  const newHash = hashUserPassword(String(newPassword));

  // Mark token used (single-use)
  await db
    .prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`)
    .bind(nowIso, row.id)
    .run();

  // Update password and increment session_version
  await db
    .prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?`)
    .bind(newHash, nowIso, row.user_id)
    .run();

  // Revoke all existing sessions for this user
  await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(row.user_id).run();

  return { ok: true };
}

