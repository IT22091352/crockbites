import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteD1Adapter, ensureCommunitySchema } from '../src/lib/db.ts';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  authenticateUser,
  confirmEmailVerificationToken,
  confirmPasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetRequest,
  createSessionForUser,
  createUserCsrfToken,
  deleteUserAccount,
  getAuthenticatedUser,
  hashToken,
  hashUserPassword,
  checkUserRateLimit,
  resetUserRateLimitsForTest,
  registerUser,
  revokeAllUserSessions,
  revokeUserSession,
  sanitizeReturnUrl,
  verifyUserCsrfToken,
  verifyUserPassword,
} from '../src/lib/user-auth.ts';
import {
  MAX_RECENTLY_VIEWED,
  addFavorite,
  addRecipeToCollection,
  createCollection,
  deleteCollection,
  deleteOwnReview,
  getCollectionDetails,
  getPublicRecipeReviews,
  listRecentlyViewed,
  listUserCollections,
  listUserFavorites,
  moderateReview,
  recordRecentlyViewed,
  removeRecipeFromCollection,
  submitOrUpdateReview,
  toggleFavorite,
  updateCollection,
  updateOwnReviewById,
} from '../src/lib/community.ts';
import { ADMIN_COOKIE_NAME } from '../src/lib/admin.ts';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = createSqliteD1Adapter(sqlite);
  await ensureCommunitySchema(db);
  return { db, sqlite };
}

const PUBLISHED_SLUGS = new Set([
  'slow-cooker-beef-stew',
  'creamy-garlic-herb-chicken',
  'honey-garlic-pork-tenderloin',
  'hearty-lentil-vegetable-soup',
]);

// Also add 25 synthetic slugs for the 20-item recently viewed cap test
for (let i = 1; i <= 25; i++) {
  PUBLISHED_SLUGS.add(`published-recipe-${i}`);
}

await test('1. Admin and User cookie namespaces are strictly isolated', async () => {
  assert.notEqual(USER_SESSION_COOKIE, ADMIN_COOKIE_NAME);
  assert.notEqual(USER_CSRF_COOKIE, ADMIN_COOKIE_NAME);
  assert.equal(USER_SESSION_COOKIE, 'crockbites_user_session');
  assert.equal(ADMIN_COOKIE_NAME, 'crockbites_admin');
});

await test('2. Password hashing uses scrypt_u1$ and verifies constant-time without storing plain text', async () => {
  const hash = hashUserPassword('SlowCooker2026');
  assert.ok(hash.startsWith('scrypt_u1$'));
  assert.ok(!hash.includes('SlowCooker2026'));
  assert.equal(verifyUserPassword('SlowCooker2026', hash), true);
  assert.equal(verifyUserPassword('WrongPassword123', hash), false);
});

await test('3. User registration validates inputs and blocks duplicate emails/usernames (case-insensitive)', async () => {
  const { db } = await createTestDb();

  // Weak password rejected
  const weak = await registerUser(db, {
    username: 'chef_anna',
    email: 'anna@example.com',
    password: 'short',
  });
  assert.equal(weak.ok, false);

  // Reserved username rejected
  const reserved = await registerUser(db, {
    username: 'admin',
    email: 'adminuser@example.com',
    password: 'SafePassword123',
  });
  assert.equal(reserved.ok, false);

  // Valid registration
  const reg1 = await registerUser(db, {
    username: 'Chef_Anna',
    email: 'Anna@Example.com',
    password: 'SafePassword123',
    displayName: 'Anna Kitchen',
  });
  assert.equal(reg1.ok, true);
  if (reg1.ok) {
    assert.equal(reg1.user.username, 'chef_anna');
    assert.equal(reg1.user.email, 'anna@example.com');
    assert.equal(reg1.user.displayName, 'Anna Kitchen');
    assert.equal(reg1.user.role, 'user');
  }

  // Duplicate username (different case) rejected
  const dupUser = await registerUser(db, {
    username: 'chef_anna',
    email: 'other@example.com',
    password: 'SafePassword123',
  });
  assert.equal(dupUser.ok, false);

  // Duplicate email (different case) rejected
  const dupEmail = await registerUser(db, {
    username: 'another_chef',
    email: 'ANNA@example.com',
    password: 'SafePassword123',
  });
  assert.equal(dupEmail.ok, false);
});

await test('4. User login, hashed session storage, session expiry, logout, and logout-all revocation', async () => {
  const { db } = await createTestDb();
  const reg = await registerUser(db, {
    username: 'mark_cooks',
    email: 'mark@example.com',
    password: 'MarkPassword99',
  });
  assert.equal(reg.ok, true);

  // Login with email
  const authOk = await authenticateUser(db, 'MARK@example.com', 'MarkPassword99');
  assert.equal(authOk.ok, true);

  // Login with wrong password fails with generic anti-enumeration message
  const authBad = await authenticateUser(db, 'mark@example.com', 'WrongPass11');
  assert.equal(authBad.ok, false);
  if (!authBad.ok) {
    assert.equal(authBad.error, 'Invalid email/username or password.');
  }

  // Create session and verify raw token is NOT stored in D1 (only SHA-256 hash)
  const userId = reg.ok ? reg.user.id : '';
  const session1 = await createSessionForUser(db, userId, 3600);
  const rawRow = await db
    .prepare(`SELECT session_token_hash FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(userId)
    .first();
  assert.ok(rawRow);
  assert.notEqual(rawRow.session_token_hash, session1.sessionToken);
  assert.equal(rawRow.session_token_hash, hashToken(session1.sessionToken));

  // Resolve authenticated user from session token
  const resolved = await getAuthenticatedUser(db, session1.sessionToken);
  assert.ok(resolved);
  assert.equal(resolved.username, 'mark_cooks');

  // Single-session logout
  await revokeUserSession(db, session1.sessionToken);
  const afterLogout = await getAuthenticatedUser(db, session1.sessionToken);
  assert.equal(afterLogout, null);

  // Multi-session logout-all revocation
  const sA = await createSessionForUser(db, userId, 3600);
  const sB = await createSessionForUser(db, userId, 3600);
  assert.ok(await getAuthenticatedUser(db, sA.sessionToken));
  assert.ok(await getAuthenticatedUser(db, sB.sessionToken));

  await revokeAllUserSessions(db, userId);
  assert.equal(await getAuthenticatedUser(db, sA.sessionToken), null);
  assert.equal(await getAuthenticatedUser(db, sB.sessionToken), null);
});

await test('5. User CSRF token verification and safe returnTo URL sanitization', async () => {
  const token = createUserCsrfToken('session_abc_123');
  const reqOk = new Request('https://crockbites.com/api/community/favorites/', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
  });
  const reqBadSession = new Request('https://crockbites.com/api/community/favorites/', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
  });
  const reqTampered = new Request('https://crockbites.com/api/community/favorites/', {
    method: 'POST',
    headers: { 'x-csrf-token': 'tampered' },
  });

  assert.equal(await verifyUserCsrfToken(reqOk, token, 'session_abc_123'), true);
  assert.equal(await verifyUserCsrfToken(reqBadSession, token, 'different_session'), false);
  assert.equal(await verifyUserCsrfToken(reqTampered, token, 'session_abc_123'), false);

  assert.equal(sanitizeReturnUrl('/recipes/slow-cooker-beef-stew/'), '/recipes/slow-cooker-beef-stew/');
  assert.equal(sanitizeReturnUrl('https://evil.example.com/phish'), '/account/');
  assert.equal(sanitizeReturnUrl('//evil.example.com'), '/account/');
  assert.equal(sanitizeReturnUrl('/admin/recipes/'), '/account/');
});

await test('6. User rate limiting throttles repeated failures and resets on clear', async () => {
  const scope = 'test_login';
  const id = '198.51.100.77';
  resetUserRateLimitsForTest();

  for (let i = 0; i < 4; i++) {
    const step = await checkUserRateLimit(scope, id, 4, 60);
    assert.equal(step.allowed, true);
  }
  const blocked = await checkUserRateLimit(scope, id, 4, 60);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  resetUserRateLimitsForTest();
  const afterClear = await checkUserRateLimit(scope, id, 4, 60);
  assert.equal(afterClear.allowed, true);
});

await test('7. Email verification and single-use password reset token workflows', async () => {
  const { db } = await createTestDb();
  const reg = await registerUser(db, {
    username: 'verify_tester',
    email: 'verify@example.com',
    password: 'InitialPass123',
  });
  assert.equal(reg.ok, true);
  const userId = reg.ok ? reg.user.id : '';

  const vToken = await createEmailVerificationToken(db, userId);
  const confirm1 = await confirmEmailVerificationToken(db, vToken.rawToken);
  assert.equal(confirm1.ok, true);

  // Single-use: second confirmation fails
  const confirm2 = await confirmEmailVerificationToken(db, vToken.rawToken);
  assert.equal(confirm2.ok, false);

  // Password reset token
  const activeSession = await createSessionForUser(db, userId, 3600);
  const resetReq = await createPasswordResetRequest(db, 'verify@example.com');
  assert.equal(resetReq.ok, true);
  assert.ok(resetReq._internalRawToken);

  const resetConfirm = await confirmPasswordResetToken(db, resetReq._internalRawToken, 'NewResetPass456');
  assert.equal(resetConfirm.ok, true);

  // Old session is revoked upon password reset
  assert.equal(await getAuthenticatedUser(db, activeSession.sessionToken), null);

  // Token cannot be reused
  const reuseConfirm = await confirmPasswordResetToken(db, resetReq._internalRawToken, 'AnotherPass789');
  assert.equal(reuseConfirm.ok, false);

  // New password works
  const loginNew = await authenticateUser(db, 'verify@example.com', 'NewResetPass456');
  assert.equal(loginNew.ok, true);
});

await test('8. Favorite recipes: add, remove, toggle, duplicate prevention, published slug check, and user isolation', async () => {
  const { db } = await createTestDb();
  const u1 = await registerUser(db, { username: 'user_one', email: 'u1@example.com', password: 'Password123' });
  const u2 = await registerUser(db, { username: 'user_two', email: 'u2@example.com', password: 'Password123' });
  assert.ok(u1.ok && u2.ok);

  // Unpublished/draft slug rejected
  const draftRes = await addFavorite(db, u1.user.id, 'non-existent-draft-slug', PUBLISHED_SLUGS);
  assert.equal(draftRes.ok, false);

  // Add favorite twice -> no duplicate row
  await addFavorite(db, u1.user.id, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);
  await addFavorite(db, u1.user.id, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);

  const u1Favs = await listUserFavorites(db, u1.user.id);
  assert.equal(u1Favs.length, 1);
  assert.equal(u1Favs[0].recipeSlug, 'slow-cooker-beef-stew');

  // User 2 has 0 favorites (isolation)
  const u2Favs = await listUserFavorites(db, u2.user.id);
  assert.equal(u2Favs.length, 0);

  // Toggle removes existing favorite
  const toggled = await toggleFavorite(db, u1.user.id, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);
  assert.equal(toggled.ok, true);
  if (toggled.ok) assert.equal(toggled.saved, false);
  assert.equal((await listUserFavorites(db, u1.user.id)).length, 0);
});

await test('9. Custom collections: CRUD, add/remove recipes, and strict private vs public authorization', async () => {
  const { db } = await createTestDb();
  const owner = await registerUser(db, { username: 'col_owner', email: 'owner@example.com', password: 'Password123' });
  const other = await registerUser(db, { username: 'col_other', email: 'other@example.com', password: 'Password123' });
  assert.ok(owner.ok && other.ok);

  // Create private collection
  const privCol = await createCollection(db, owner.user.id, {
    name: 'Weeknight Favorites',
    description: 'Private family meals',
    isPublic: false,
  });
  assert.equal(privCol.ok, true);
  const colId = privCol.ok ? privCol.collection.id : '';

  // Add recipe twice -> deduplicated
  await addRecipeToCollection(db, owner.user.id, colId, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);
  await addRecipeToCollection(db, owner.user.id, colId, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);

  // Owner can access private collection
  const ownerView = await getCollectionDetails(db, colId, owner.user.id);
  assert.ok(ownerView);
  assert.equal(ownerView.recipeCount, 1);

  // Guest and other user CANNOT access private collection
  const guestView = await getCollectionDetails(db, colId, null);
  const otherView = await getCollectionDetails(db, colId, other.user.id);
  assert.equal(guestView, null);
  assert.equal(otherView, null);

  // Other user cannot modify or delete owner's collection
  const unauthorizedDelete = await deleteCollection(db, other.user.id, colId);
  assert.equal(unauthorizedDelete.ok, false);

  // Update collection to public
  await updateCollection(db, owner.user.id, colId, { isPublic: true });
  const publicGuestView = await getCollectionDetails(db, colId, null);
  assert.ok(publicGuestView);
  assert.equal(publicGuestView.userId, ''); // Internal owner userId hidden from non-owners

  // Remove recipe and delete collection
  await removeRecipeFromCollection(db, owner.user.id, colId, 'slow-cooker-beef-stew');
  assert.equal((await getCollectionDetails(db, colId, owner.user.id))?.recipeCount, 0);
  await deleteCollection(db, owner.user.id, colId);
  assert.equal(await getCollectionDetails(db, colId, owner.user.id), null);
});

await test('10. Recently viewed recipes: deduplicates repeated views and enforces max 20 items per user', async () => {
  const { db } = await createTestDb();
  const u = await registerUser(db, { username: 'viewer_user', email: 'viewer@example.com', password: 'Password123' });
  assert.ok(u.ok);

  // Unpublished slug ignored
  const bad = await recordRecentlyViewed(db, u.user.id, 'draft-unpublished-slug', PUBLISHED_SLUGS);
  assert.equal(bad.ok, false);

  // Record 25 distinct published recipes
  for (let i = 1; i <= 25; i++) {
    await recordRecentlyViewed(db, u.user.id, `published-recipe-${i}`, PUBLISHED_SLUGS);
  }

  const list = await listRecentlyViewed(db, u.user.id);
  assert.equal(list.length, MAX_RECENTLY_VIEWED);
  assert.equal(list.length, 20);

  // Re-viewing an existing recipe updates its timestamp without creating a duplicate
  await recordRecentlyViewed(db, u.user.id, 'published-recipe-10', PUBLISHED_SLUGS);
  const listAfter = await listRecentlyViewed(db, u.user.id);
  assert.equal(listAfter.length, 20);
  assert.equal(listAfter[0].recipeSlug, 'published-recipe-10');
});

await test('11. Reviews & Admin Moderation: pending by default, excluded from public stats until approved, XSS escaped, 1 per user per recipe', async () => {
  const { db } = await createTestDb();
  const u1 = await registerUser(db, {
    username: 'reviewer_one',
    email: 'r1@example.com',
    password: 'Password123',
    displayName: 'Reviewer One',
  });
  const u2 = await registerUser(db, {
    username: 'reviewer_two',
    email: 'r2@example.com',
    password: 'Password123',
    displayName: 'Reviewer Two',
  });
  assert.ok(u1.ok && u2.ok);

  // Invalid rating (0 or 6) rejected
  const invalidRating = await submitOrUpdateReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 6,
      title: 'Too many stars',
      comment: 'This should be rejected by validation.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(invalidRating.ok, false);

  // Submit review with HTML tags to verify XSS escaping
  const rev1 = await submitOrUpdateReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 5,
      title: 'Great <script>alert(1)</script> Stew!',
      comment: 'Cooked on LOW for 8 hours & the beef was tender.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(rev1.ok, true);
  if (rev1.ok) {
    assert.equal(rev1.review.status, 'pending');
    assert.ok(!rev1.review.title.includes('<script>'));
    assert.ok(rev1.review.title.includes('&lt;script&gt;'));
  }

  // While pending, public stats must show 0 approved reviews and 0 averageRating
  const publicBefore = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicBefore.totalApproved, 0);
  assert.equal(publicBefore.averageRating, 0);
  assert.equal(publicBefore.reviews.length, 0);

  // Admin approves review 1
  const rev1Id = rev1.ok ? rev1.review.id : '';
  const modApprove = await moderateReview(db, rev1Id, 'approved', 'admin_editor');
  assert.equal(modApprove.ok, true);

  // User 2 submits a 3-star review and admin approves it
  const rev2 = await submitOrUpdateReview(
    db,
    u2.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 3,
      title: 'Good weeknight meal',
      comment: 'Needed a pinch more salt for our taste.',
    },
    PUBLISHED_SLUGS,
  );
  assert.ok(rev2.ok);
  await moderateReview(db, rev2.review.id, 'approved', 'admin_editor');

  // Public stats now reflect both approved reviews: (5 + 3) / 2 = 4.0
  const publicAfter = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicAfter.totalApproved, 2);
  assert.equal(publicAfter.averageRating, 4);
  assert.equal(publicAfter.distribution[5], 1);
  assert.equal(publicAfter.distribution[3], 1);

  // User 2 cannot edit or delete User 1's review
  const unauthorizedEdit = await updateOwnReviewById(db, u2.user, rev1Id, {
    rating: 1,
    title: 'Hacked title',
    comment: 'Trying to edit another user review.',
  });
  assert.equal(unauthorizedEdit.ok, false);

  const unauthorizedDel = await deleteOwnReview(db, u2.user.id, rev1Id);
  assert.equal(unauthorizedDel.ok, false);

  // If User 1 updates their own review, it resets status to 'pending' until re-moderated
  const updatedOwn = await submitOrUpdateReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 4,
      title: 'Updated headline',
      comment: 'Updated comment after making it a second time.',
    },
    PUBLISHED_SLUGS,
  );
  assert.ok(updatedOwn.ok);
  assert.equal(updatedOwn.isUpdate, true);
  assert.equal(updatedOwn.review.status, 'pending');
});

await test('12. Account deletion purges PII/sessions/favorites/collections and anonymizes approved reviews to "Deleted User"', async () => {
  const { db } = await createTestDb();
  const u = await registerUser(db, {
    username: 'privacy_cook',
    email: 'privacy@example.com',
    password: 'DeleteMePass99',
    displayName: 'Privacy Cook',
  });
  assert.ok(u.ok);

  const session = await createSessionForUser(db, u.user.id, 3600);
  await addFavorite(db, u.user.id, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);
  await createCollection(db, u.user.id, { name: 'My Secret Recipes', isPublic: false });
  await recordRecentlyViewed(db, u.user.id, 'slow-cooker-beef-stew', PUBLISHED_SLUGS);

  // Create one approved review and one pending review
  const rApproved = await submitOrUpdateReview(
    db,
    u.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 5,
      title: 'Loved this stew',
      comment: 'Will remain as an anonymized community review.',
    },
    PUBLISHED_SLUGS,
  );
  assert.ok(rApproved.ok);
  await moderateReview(db, rApproved.review.id, 'approved', 'admin');

  const rPending = await submitOrUpdateReview(
    db,
    u.user,
    {
      recipeSlug: 'creamy-garlic-herb-chicken',
      rating: 4,
      title: 'Pending review',
      comment: 'Unapproved review should be deleted with account.',
    },
    PUBLISHED_SLUGS,
  );
  assert.ok(rPending.ok);

  // Wrong password fails account deletion
  const badDel = await deleteUserAccount(db, u.user.id, 'WrongPassword');
  assert.equal(badDel.ok, false);

  // Confirmed deletion succeeds
  const goodDel = await deleteUserAccount(db, u.user.id, 'DeleteMePass99');
  assert.equal(goodDel.ok, true);

  // Session, favorites, collections, recently viewed, and pending review are gone
  assert.equal(await getAuthenticatedUser(db, session.sessionToken), null);
  assert.equal((await listUserFavorites(db, u.user.id)).length, 0);
  assert.equal((await listUserCollections(db, u.user.id)).length, 0);
  assert.equal((await listRecentlyViewed(db, u.user.id)).length, 0);

  const pendingCheck = await db.prepare(`SELECT id FROM reviews WHERE id = ?`).bind(rPending.review.id).first();
  assert.equal(pendingCheck, null);

  // Approved review is retained with user_id = NULL and author_display_name = 'Deleted User'
  const pubReviews = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(pubReviews.totalApproved, 1);
  assert.equal(pubReviews.reviews[0].authorDisplayName, 'Deleted User');
  assert.equal(pubReviews.reviews[0].userId, null);

  // Non-PII audit log entry recorded
  const auditRow = await db.prepare(`SELECT * FROM account_audit_log WHERE event_type = 'account_deleted' LIMIT 1`).first();
  assert.ok(auditRow);
});

console.log(`\nAll ${passed} Phase 3 Community Platform test suites passed!`);
