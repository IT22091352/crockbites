import assert from 'node:assert/strict';
import {
  createPasswordHash,
  verifyPassword,
  generateSessionId,
  getSessionVersion,
  buildSessionCookie,
  parseAdminSessionCookie,
  verifySessionCookie,
  createCsrfToken,
  checkRateLimit,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
  getRateLimitStorageInfo,
  LOGIN_MAX_FAILED_ATTEMPTS,
} from '../src/lib/admin.ts';

// 1. Password Hash Verification
const hash1 = createPasswordHash('S3cretPass!');
assert.equal(verifyPassword('S3cretPass!', hash1), true, 'password hash verifies');
assert.equal(verifyPassword('WrongPass!', hash1), false, 'wrong password rejects');

// 2. Session Token & Immediate Revocation via Password Hash Rotation
const secret = 'test-secret-key-32-chars-length!!';
const version1 = getSessionVersion(hash1);
const cookie1 = buildSessionCookie('admin', secret, version1);
const parsed1 = parseAdminSessionCookie(cookie1);

assert.ok(parsed1, 'session cookie parses');
assert.equal(parsed1.version, version1, 'session cookie contains session version');
assert.equal(verifySessionCookie(cookie1, secret, version1), true, 'session verifies with matching version');
assert.equal(verifySessionCookie(cookie1, 'wrong-secret', version1), false, 'wrong secret invalidates session');

// Simulate admin changing password: new hash produces new version
const hash2 = createPasswordHash('NewS3cretPass2026!');
const version2 = getSessionVersion(hash2);
assert.notEqual(version1, version2, 'new password hash produces a different session version');

// Verifying old session with the new version MUST fail (immediate revocation)
assert.equal(verifySessionCookie(cookie1, secret, version2), false, 'old session immediately invalidated after password change');

// Newly issued session with new version succeeds
const cookie2 = buildSessionCookie('admin', secret, version2);
assert.equal(verifySessionCookie(cookie2, secret, version2), true, 'new session verifies with new version');

// 3. CSRF Protection
const sessionId = generateSessionId();
const csrf = createCsrfToken(secret, sessionId);
assert.equal(typeof csrf, 'string');
assert.ok(csrf.length > 20, 'csrf token generated');

// 4. Generic API Rate Limiter
const genericKey = 'rate-limit:test-generic';
for (let i = 0; i < 9; i += 1) {
  assert.equal(checkRateLimit(genericKey), true, `generic rate limit allow ${i + 1}`);
}
assert.equal(checkRateLimit(genericKey), false, 'generic rate limit blocks after threshold');

// 5. Login Rate Limiting (IP & Account Based)
const testIp = '198.51.100.42';
const testUser = 'admin_rate_test';

// Initially allowed
const initialCheck = await checkLoginRateLimit(testIp, testUser);
assert.equal(initialCheck.allowed, true, 'login allowed initially');

// Record failed attempts up to limit
for (let i = 1; i < LOGIN_MAX_FAILED_ATTEMPTS; i += 1) {
  const res = await recordFailedLogin(testIp, testUser);
  assert.equal(res.locked, false, `attempt ${i} does not lock yet`);
}

// 5th failed attempt triggers lockout
const lockResult = await recordFailedLogin(testIp, testUser);
assert.equal(lockResult.locked, true, '5th failed attempt locks out');
assert.ok(lockResult.retryAfterSeconds > 0, 'provides retryAfterSeconds');

// Check rate limit now reports blocked
const blockedCheck = await checkLoginRateLimit(testIp, testUser);
assert.equal(blockedCheck.allowed, false, 'login rate limit blocks locked IP/user');
assert.ok(blockedCheck.retryAfterSeconds > 0, 'retry-after info present');

// Reset rate limit (simulating successful login)
await resetLoginRateLimit(testIp, testUser);
const resetCheck = await checkLoginRateLimit(testIp, testUser);
assert.equal(resetCheck.allowed, true, 'resetting rate limit unblocks access');

// 6. Rate Limit Storage Info Reporting
const storageInfo = getRateLimitStorageInfo();
assert.equal(typeof storageInfo.isDistributed, 'boolean');
assert.equal(storageInfo.bindingName, 'RATE_LIMIT_KV');
assert.ok(storageInfo.details.length > 0, 'provides descriptive storage details');

console.log('auth-security checks passed');
