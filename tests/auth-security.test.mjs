import assert from 'node:assert/strict';
import { createPasswordHash, verifyPassword, generateSessionId, buildSessionCookie, parseAdminSessionCookie, verifySessionCookie, createCsrfToken, checkRateLimit } from '../src/lib/admin.ts';

const hash = createPasswordHash('S3cretPass!');
assert.equal(verifyPassword('S3cretPass!', hash), true, 'password hash verifies');
assert.equal(verifyPassword('WrongPass!', hash), false, 'wrong password rejects');

const sessionId = generateSessionId();
const cookie = buildSessionCookie('admin', 'test-secret');
const parsed = parseAdminSessionCookie(cookie);
assert.ok(parsed, 'session cookie parses');
assert.equal(verifySessionCookie(cookie, 'test-secret'), true, 'session verifies when signed correctly');
assert.equal(verifySessionCookie(cookie, 'wrong-secret'), false, 'wrong secret invalidates session');

const csrf = createCsrfToken('test-secret', sessionId);
assert.equal(typeof csrf, 'string');
assert.ok(csrf.length > 20, 'csrf token generated');

const key = 'rate-limit:test';
for (let i = 0; i < 9; i += 1) {
  assert.equal(checkRateLimit(key), true, `rate limit allow ${i + 1}`);
}
assert.equal(checkRateLimit(key), false, 'rate limit blocks after threshold');

console.log('auth-security checks passed');
