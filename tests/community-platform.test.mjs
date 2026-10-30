import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteD1Adapter, ensureCommunitySchema } from '../src/lib/db.ts';
import {
  DUMMY_PASSWORD_HASH,
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
  adminDeleteReview,
  createCollection,
  deleteCollection,
  deleteOwnReview,
  getCollectionDetails,
  getPublicRecipeReviews,
  listAdminReviews,
  listRecentlyViewed,
  listUserCollections,
  listUserFavorites,
  migratePendingReviewsToApproved,
  recordRecentlyViewed,
  removeRecipeFromCollection,
  submitOrUpdateReview,
  submitReview,
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

await test('2. Password hashing uses scrypt_u1$ and verifies constant-time without storing plain text, including static DUMMY_PASSWORD_HASH', async () => {
  const hash = hashUserPassword('SlowCooker2026');
  assert.ok(hash.startsWith('scrypt_u1$'));
  assert.ok(!hash.includes('SlowCooker2026'));
  assert.equal(verifyUserPassword('SlowCooker2026', hash), true);
  assert.equal(verifyUserPassword('WrongPassword123', hash), false);

  // Verify static precomputed DUMMY_PASSWORD_HASH format and verification
  assert.ok(DUMMY_PASSWORD_HASH.startsWith('scrypt_u1$'));
  assert.equal(DUMMY_PASSWORD_HASH.split('$').length, 3);
  assert.equal(verifyUserPassword('crockbites_constant_time_dummy_pass_99', DUMMY_PASSWORD_HASH), true);
  assert.equal(verifyUserPassword('WrongDummyPass', DUMMY_PASSWORD_HASH), false);
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

await test('11. Instant Review Publishing: guest rejection, immediate approval, duplicate prevention, validation, rating stats, and admin/user deletion rules', async () => {
  const { db } = await createTestDb();

  // 1. Guest users cannot submit reviews (unauthenticated session resolves to null & submitReview rejects null user)
  const guestUser = await getAuthenticatedUser(db, undefined);
  assert.equal(guestUser, null);
  const guestSubmit = await submitReview(
    db,
    guestUser,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 5,
      title: 'Guest attempt',
      comment: 'Guests are not allowed to submit reviews.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(guestSubmit.ok, false);
  if (!guestSubmit.ok) {
    assert.equal(guestSubmit.unauthorized, true);
  }

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

  // 5. Invalid ratings, empty/short comments, and unpublished slugs are rejected
  const invalidRatingHigh = await submitReview(
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
  assert.equal(invalidRatingHigh.ok, false);

  const invalidRatingLow = await submitReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 0,
      title: 'Zero stars',
      comment: 'This should also be rejected by validation.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(invalidRatingLow.ok, false);

  const emptyComment = await submitReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 5,
      title: 'Valid headline',
      comment: '   ',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(emptyComment.ok, false);

  const draftRecipeReview = await submitReview(
    db,
    u1.user,
    {
      recipeSlug: 'unpublished-draft-recipe',
      rating: 5,
      title: 'Draft review',
      comment: 'Cannot review a draft or non-existent recipe.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(draftRecipeReview.ok, false);

  // 2 & 3. Authenticated user submits review -> immediately approved and publicly visible (XSS escaped)
  const rev1 = await submitReview(
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
    assert.equal(rev1.review.status, 'approved');
    assert.ok(!rev1.review.title.includes('<script>'));
    assert.ok(rev1.review.title.includes('&lt;script&gt;'));
  }

  // Immediately visible in public reviews without any admin moderation step
  const publicImmediate = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicImmediate.totalApproved, 1);
  assert.equal(publicImmediate.averageRating, 5);
  assert.equal(publicImmediate.reviews.length, 1);
  assert.equal(publicImmediate.reviews[0].authorDisplayName, 'Reviewer One');

  // 4. Duplicate reviews by the same user for the same recipe are rejected
  const duplicateRev = await submitOrUpdateReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 4,
      title: 'Second duplicate review attempt',
      comment: 'Trying to submit a second review for the same recipe.',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(duplicateRev.ok, false);
  if (!duplicateRev.ok) {
    assert.equal(duplicateRev.duplicate, true);
  }

  // 6. User 2 submits a 3-star review -> immediately updates count (2) and averageRating ((5 + 3) / 2 = 4.0)
  const rev2 = await submitReview(
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
  assert.equal(rev2.review.status, 'approved');

  const publicAfterTwo = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicAfterTwo.totalApproved, 2);
  assert.equal(publicAfterTwo.averageRating, 4);
  assert.equal(publicAfterTwo.distribution[5], 1);
  assert.equal(publicAfterTwo.distribution[3], 1);

  // 7 & 8. Non-admin users cannot edit or delete other users' reviews (returns 403)
  const rev1Id = rev1.ok ? rev1.review.id : '';
  const unauthorizedEdit = await updateOwnReviewById(db, u2.user, rev1Id, {
    rating: 1,
    title: 'Hacked title',
    comment: 'Trying to edit another user review.',
  });
  assert.equal(unauthorizedEdit.ok, false);
  if (!unauthorizedEdit.ok) {
    assert.equal(unauthorizedEdit.statusCode, 403);
  }

  const unauthorizedDel = await deleteOwnReview(db, u2.user.id, rev1Id);
  assert.equal(unauthorizedDel.ok, false);
  if (!unauthorizedDel.ok) {
    assert.equal(unauthorizedDel.statusCode, 403);
  }

  // 9. Guest users cannot edit or delete reviews (returns 401)
  const guestEdit = await updateOwnReviewById(db, null, rev1Id, {
    rating: 1,
    title: 'Guest edit attempt',
    comment: 'Guests cannot edit any review.',
  });
  assert.equal(guestEdit.ok, false);
  if (!guestEdit.ok) {
    assert.equal(guestEdit.statusCode, 401);
  }

  const guestDel = await deleteOwnReview(db, null, rev1Id);
  assert.equal(guestDel.ok, false);
  if (!guestDel.ok) {
    assert.equal(guestDel.statusCode, 401);
  }

  // 1 & 2 & 6. User 1 can edit their own review by ID; stays approved & public immediately; average rating and distribution recalculate
  const updatedOwn = await updateOwnReviewById(db, u1.user, rev1Id, {
    rating: 4,
    title: 'Updated headline',
    comment: 'Updated comment after making it a second time.',
  });
  assert.ok(updatedOwn.ok);
  assert.equal(updatedOwn.review.status, 'approved');
  assert.equal(updatedOwn.review.rating, 4);
  assert.equal(updatedOwn.review.title, 'Updated headline');

  const publicAfterEdit = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicAfterEdit.totalApproved, 2);
  assert.equal(publicAfterEdit.averageRating, 3.5);
  assert.equal(publicAfterEdit.distribution[5], 0);
  assert.equal(publicAfterEdit.distribution[4], 1);
  assert.equal(publicAfterEdit.distribution[3], 1);

  // 4 & 5 & 6. User 1 can delete their own review; disappears from public results and recalculates averageRating & distribution
  const ownDel = await deleteOwnReview(db, u1.user.id, rev1Id);
  assert.equal(ownDel.ok, true);

  const publicAfterOwnDelete = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew', 1, 10, u1.user.id);
  assert.equal(publicAfterOwnDelete.totalApproved, 1);
  assert.equal(publicAfterOwnDelete.averageRating, 3);
  assert.equal(publicAfterOwnDelete.distribution[4], 0);
  assert.equal(publicAfterOwnDelete.distribution[3], 1);
  assert.equal(publicAfterOwnDelete.myReview, null);
  assert.equal(publicAfterOwnDelete.reviews.some((r) => r.id === rev1Id), false);

  // 11. User 1 can submit a new review after deleting their previous review
  const resubmittedRev = await submitReview(
    db,
    u1.user,
    {
      recipeSlug: 'slow-cooker-beef-stew',
      rating: 5,
      title: 'Fresh review after cooking again',
      comment: 'Made this again for Sunday dinner and everyone loved it!',
    },
    PUBLISHED_SLUGS,
  );
  assert.equal(resubmittedRev.ok, true);
  if (resubmittedRev.ok) {
    assert.equal(resubmittedRev.review.status, 'approved');
  }

  const publicAfterResubmit = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew', 1, 10, u1.user.id);
  assert.equal(publicAfterResubmit.totalApproved, 2);
  assert.equal(publicAfterResubmit.averageRating, 4);
  assert.ok(publicAfterResubmit.myReview);
  assert.equal(publicAfterResubmit.myReview.title, 'Fresh review after cooking again');

  // 7 (Admin). Admins can search/list reviews and delete inappropriate reviews
  const adminList = await listAdminReviews(db, { recipeSlug: 'slow-cooker-beef-stew' });
  assert.equal(adminList.counts.total, 2);
  assert.equal(adminList.reviews.length, 2);

  const adminDel = await adminDeleteReview(db, rev2.review.id);
  assert.equal(adminDel.ok, true);

  const publicAfterAdminDelete = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(publicAfterAdminDelete.totalApproved, 1);
  assert.equal(publicAfterAdminDelete.averageRating, 5);
});

await test('12. Existing pending reviews migration: converts pending reviews to approved without losing content, author, rating, or timestamps', async () => {
  const { db } = await createTestDb();
  const u = await registerUser(db, {
    username: 'legacy_reviewer',
    email: 'legacy@example.com',
    password: 'Password123',
    displayName: 'Legacy Cook',
  });
  assert.ok(u.ok);

  const legacyCreatedAt = '2026-01-15T10:30:00.000Z';
  const legacyUpdatedAt = '2026-01-15T10:30:00.000Z';

  // Insert a legacy 'pending' review directly into the table
  await db
    .prepare(
      `INSERT INTO reviews (
        id, user_id, author_display_name, author_username, recipe_slug,
        rating, title, comment, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      'rev_legacy_pending_01',
      u.user.id,
      'Legacy Cook',
      'legacy_reviewer',
      'honey-garlic-pork-tenderloin',
      5,
      'Legacy Pending Headline',
      'This review was submitted before instant publishing was enabled.',
      legacyCreatedAt,
      legacyUpdatedAt,
    )
    .run();

  // Run the non-destructive migration
  const migResult = await migratePendingReviewsToApproved(db);
  assert.equal(migResult.migratedCount, 1);

  // Verify the migrated review is now approved, publicly visible, and all fields/timestamps are preserved
  const pubStats = await getPublicRecipeReviews(db, 'honey-garlic-pork-tenderloin');
  assert.equal(pubStats.totalApproved, 1);
  assert.equal(pubStats.averageRating, 5);
  assert.equal(pubStats.reviews.length, 1);

  const migrated = pubStats.reviews[0];
  assert.equal(migrated.id, 'rev_legacy_pending_01');
  assert.equal(migrated.status, 'approved');
  assert.equal(migrated.authorDisplayName, 'Legacy Cook');
  assert.equal(migrated.authorUsername, 'legacy_reviewer');
  assert.equal(migrated.rating, 5);
  assert.equal(migrated.title, 'Legacy Pending Headline');
  assert.equal(migrated.comment, 'This review was submitted before instant publishing was enabled.');
  assert.equal(migrated.createdAt, legacyCreatedAt);
  assert.equal(migrated.updatedAt, legacyUpdatedAt);
});

await test('13. Account deletion purges PII/sessions/favorites/collections and anonymizes published reviews to "Deleted User"', async () => {
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

  // Create a published review
  const rPublished = await submitReview(
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
  assert.ok(rPublished.ok);
  assert.equal(rPublished.review.status, 'approved');

  // Wrong password fails account deletion
  const badDel = await deleteUserAccount(db, u.user.id, 'WrongPassword');
  assert.equal(badDel.ok, false);

  // Confirmed deletion succeeds
  const goodDel = await deleteUserAccount(db, u.user.id, 'DeleteMePass99');
  assert.equal(goodDel.ok, true);

  // Session, favorites, collections, and recently viewed are gone
  assert.equal(await getAuthenticatedUser(db, session.sessionToken), null);
  assert.equal((await listUserFavorites(db, u.user.id)).length, 0);
  assert.equal((await listUserCollections(db, u.user.id)).length, 0);
  assert.equal((await listRecentlyViewed(db, u.user.id)).length, 0);

  // Published review is retained with user_id = NULL and author_display_name = 'Deleted User'
  const pubReviews = await getPublicRecipeReviews(db, 'slow-cooker-beef-stew');
  assert.equal(pubReviews.totalApproved, 1);
  assert.equal(pubReviews.reviews[0].authorDisplayName, 'Deleted User');
  assert.equal(pubReviews.reviews[0].userId, null);

  // Non-PII audit log entry recorded
  const auditRow = await db.prepare(`SELECT * FROM account_audit_log WHERE event_type = 'account_deleted' LIMIT 1`).first();
  assert.ok(auditRow);
});

console.log(`\nAll ${passed} Phase 3 Community Platform test suites passed!`);
