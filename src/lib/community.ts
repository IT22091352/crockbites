import type { D1Database } from './db.ts';
import { escapeHtml, generateId, sanitizePlainText, type SafeUser } from './user-auth.ts';

export interface CollectionSummary {
  id: string;
  userId: string;
  name: string;
  description: string;
  isPublic: boolean;
  recipeCount: number;
  containsTargetRecipe?: boolean;
  recipeSlugs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewItem {
  id: string;
  userId: string | null;
  authorDisplayName: string;
  authorUsername: string;
  recipeSlug: string;
  rating: number;
  title: string;
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicRecipeReviewStats {
  recipeSlug: string;
  averageRating: number;
  totalApproved: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  reviews: ReviewItem[];
  page: number;
  pageSize: number;
  totalPages: number;
  myReview: ReviewItem | null;
}

function normalizeSlug(slug: unknown): string {
  return typeof slug === 'string' ? slug.trim().toLowerCase() : '';
}

function validatePublishedSlug(slug: unknown, publishedSlugs?: Set<string>): { valid: boolean; slug: string; error?: string } {
  const clean = normalizeSlug(slug);
  if (!clean || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
    return { valid: false, slug: clean, error: 'Invalid recipe identifier.' };
  }
  if (publishedSlugs && !publishedSlugs.has(clean)) {
    return { valid: false, slug: clean, error: 'Recipe not found or not published.' };
  }
  return { valid: true, slug: clean };
}

// ============================================================================
// 1. FAVORITES
// ============================================================================

export async function addFavorite(
  db: D1Database,
  userId: string,
  recipeSlug: unknown,
  publishedSlugs?: Set<string>,
): Promise<{ ok: true; saved: boolean; recipeSlug: string } | { ok: false; error: string }> {
  const sCheck = validatePublishedSlug(recipeSlug, publishedSlugs);
  if (!sCheck.valid) return { ok: false, error: sCheck.error! };

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO favorites (id, user_id, recipe_slug, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(generateId(), userId, sCheck.slug, nowIso)
    .run();

  return { ok: true, saved: true, recipeSlug: sCheck.slug };
}

export async function removeFavorite(
  db: D1Database,
  userId: string,
  recipeSlug: unknown,
): Promise<{ ok: true; saved: boolean; recipeSlug: string } | { ok: false; error: string }> {
  const clean = normalizeSlug(recipeSlug);
  if (!clean) return { ok: false, error: 'Invalid recipe identifier.' };

  await db
    .prepare(`DELETE FROM favorites WHERE user_id = ? AND recipe_slug = ?`)
    .bind(userId, clean)
    .run();

  return { ok: true, saved: false, recipeSlug: clean };
}

export async function toggleFavorite(
  db: D1Database,
  userId: string,
  recipeSlug: unknown,
  publishedSlugs?: Set<string>,
): Promise<{ ok: true; saved: boolean; recipeSlug: string } | { ok: false; error: string }> {
  const clean = normalizeSlug(recipeSlug);
  if (!clean) return { ok: false, error: 'Invalid recipe identifier.' };

  const existing = await db
    .prepare(`SELECT id FROM favorites WHERE user_id = ? AND recipe_slug = ? LIMIT 1`)
    .bind(userId, clean)
    .first();

  if (existing) {
    return removeFavorite(db, userId, clean);
  }
  return addFavorite(db, userId, clean, publishedSlugs);
}

export async function listUserFavorites(
  db: D1Database,
  userId: string,
): Promise<Array<{ recipeSlug: string; createdAt: string }>> {
  const res = await db
    .prepare(`SELECT recipe_slug, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<{ recipe_slug: string; created_at: string }>();

  return (res.results ?? []).map((r) => ({
    recipeSlug: String(r.recipe_slug),
    createdAt: String(r.created_at),
  }));
}

// ============================================================================
// 2. CUSTOM RECIPE COLLECTIONS
// ============================================================================

export async function createCollection(
  db: D1Database,
  userId: string,
  input: { name: unknown; description?: unknown; isPublic?: unknown },
): Promise<{ ok: true; collection: CollectionSummary } | { ok: false; error: string }> {
  const rawName = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (rawName.length < 2 || rawName.length > 80) {
    return { ok: false, error: 'Collection name must be between 2 and 80 characters.' };
  }

  const name = escapeHtml(rawName);
  const description = sanitizePlainText(input.description ?? '', 300);
  const isPublic = Boolean(input.isPublic) ? 1 : 0;
  const id = generateId();
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO collections (id, user_id, name, description, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, name, description, isPublic, nowIso, nowIso)
    .run();

  return {
    ok: true,
    collection: {
      id,
      userId,
      name,
      description,
      isPublic: isPublic === 1,
      recipeCount: 0,
      recipeSlugs: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

export async function updateCollection(
  db: D1Database,
  userId: string,
  collectionId: string,
  input: { name?: unknown; description?: unknown; isPublic?: unknown },
): Promise<{ ok: true; collection: CollectionSummary } | { ok: false; error: string }> {
  const existing = await db
    .prepare(`SELECT * FROM collections WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(collectionId, userId)
    .first<Record<string, unknown>>();

  if (!existing) {
    return { ok: false, error: 'Collection not found or access denied.' };
  }

  let name = String(existing.name);
  if (input.name !== undefined) {
    const rawName = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (rawName.length < 2 || rawName.length > 80) {
      return { ok: false, error: 'Collection name must be between 2 and 80 characters.' };
    }
    name = escapeHtml(rawName);
  }

  const description =
    input.description !== undefined ? sanitizePlainText(input.description, 300) : String(existing.description ?? '');
  const isPublic = input.isPublic !== undefined ? (Boolean(input.isPublic) ? 1 : 0) : Number(existing.is_public);
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `UPDATE collections
       SET name = ?, description = ?, is_public = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(name, description, isPublic, nowIso, collectionId, userId)
    .run();

  const detail = await getCollectionDetails(db, collectionId, userId);
  if (!detail) return { ok: false, error: 'Failed to load updated collection.' };
  return { ok: true, collection: detail };
}

export async function deleteCollection(
  db: D1Database,
  userId: string,
  collectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db
    .prepare(`SELECT id FROM collections WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(collectionId, userId)
    .first();

  if (!existing) {
    return { ok: false, error: 'Collection not found or access denied.' };
  }

  await db.prepare(`DELETE FROM collections WHERE id = ? AND user_id = ?`).bind(collectionId, userId).run();
  return { ok: true };
}

export async function addRecipeToCollection(
  db: D1Database,
  userId: string,
  collectionId: string,
  recipeSlug: unknown,
  publishedSlugs?: Set<string>,
): Promise<{ ok: true; added: boolean } | { ok: false; error: string }> {
  const sCheck = validatePublishedSlug(recipeSlug, publishedSlugs);
  if (!sCheck.valid) return { ok: false, error: sCheck.error! };

  const col = await db
    .prepare(`SELECT id FROM collections WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(collectionId, userId)
    .first();

  if (!col) {
    return { ok: false, error: 'Collection not found or access denied.' };
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO collection_recipes (id, collection_id, recipe_slug, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(generateId(), collectionId, sCheck.slug, nowIso)
    .run();

  await db
    .prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`)
    .bind(nowIso, collectionId)
    .run();

  return { ok: true, added: true };
}

export async function removeRecipeFromCollection(
  db: D1Database,
  userId: string,
  collectionId: string,
  recipeSlug: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeSlug(recipeSlug);
  const col = await db
    .prepare(`SELECT id FROM collections WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(collectionId, userId)
    .first();

  if (!col) {
    return { ok: false, error: 'Collection not found or access denied.' };
  }

  await db
    .prepare(`DELETE FROM collection_recipes WHERE collection_id = ? AND recipe_slug = ?`)
    .bind(collectionId, clean)
    .run();

  await db
    .prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), collectionId)
    .run();

  return { ok: true };
}

export async function listUserCollections(
  db: D1Database,
  userId: string,
  targetRecipeSlug?: string,
): Promise<CollectionSummary[]> {
  // Single query for collections + single batched query for items (avoids N+1 queries)
  const colsRes = await db
    .prepare(`SELECT * FROM collections WHERE user_id = ? ORDER BY updated_at DESC`)
    .bind(userId)
    .all<Record<string, unknown>>();

  const cols = colsRes.results ?? [];
  if (cols.length === 0) return [];

  const itemsRes = await db
    .prepare(
      `SELECT cr.collection_id, cr.recipe_slug
       FROM collection_recipes cr
       INNER JOIN collections c ON c.id = cr.collection_id
       WHERE c.user_id = ?
       ORDER BY cr.created_at DESC`,
    )
    .bind(userId)
    .all<{ collection_id: string; recipe_slug: string }>();

  const slugsByCollection = new Map<string, string[]>();
  for (const row of itemsRes.results ?? []) {
    const list = slugsByCollection.get(row.collection_id) ?? [];
    list.push(row.recipe_slug);
    slugsByCollection.set(row.collection_id, list);
  }

  const cleanTarget = targetRecipeSlug ? normalizeSlug(targetRecipeSlug) : '';

  return cols.map((c) => {
    const id = String(c.id);
    const slugs = slugsByCollection.get(id) ?? [];
    return {
      id,
      userId: String(c.user_id),
      name: String(c.name),
      description: String(c.description ?? ''),
      isPublic: Number(c.is_public) === 1,
      recipeCount: slugs.length,
      containsTargetRecipe: cleanTarget ? slugs.includes(cleanTarget) : undefined,
      recipeSlugs: slugs,
      createdAt: String(c.created_at),
      updatedAt: String(c.updated_at),
    };
  });
}

export async function getCollectionDetails(
  db: D1Database,
  collectionId: string,
  requestingUserId?: string | null,
): Promise<(CollectionSummary & { ownerDisplayName?: string }) | null> {
  const row = await db
    .prepare(
      `SELECT c.*, u.display_name AS owner_display_name
       FROM collections c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .bind(collectionId)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const isOwner = Boolean(requestingUserId && String(row.user_id) === requestingUserId);
  const isPublic = Number(row.is_public) === 1;

  // Enforce private collection authorization
  if (!isOwner && !isPublic) {
    return null;
  }

  const itemsRes = await db
    .prepare(`SELECT recipe_slug FROM collection_recipes WHERE collection_id = ? ORDER BY created_at DESC`)
    .bind(collectionId)
    .all<{ recipe_slug: string }>();

  const slugs = (itemsRes.results ?? []).map((r) => String(r.recipe_slug));

  return {
    id: String(row.id),
    userId: isOwner ? String(row.user_id) : '', // Do not expose internal user_id to non-owners
    name: String(row.name),
    description: String(row.description ?? ''),
    isPublic,
    recipeCount: slugs.length,
    recipeSlugs: slugs,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ownerDisplayName: String(row.owner_display_name ?? 'CrockBites Member'),
  };
}

// ============================================================================
// 3. RECENTLY VIEWED RECIPES
// ============================================================================

export const MAX_RECENTLY_VIEWED = 20;

export async function recordRecentlyViewed(
  db: D1Database,
  userId: string,
  recipeSlug: unknown,
  publishedSlugs?: Set<string>,
): Promise<{ ok: boolean }> {
  const sCheck = validatePublishedSlug(recipeSlug, publishedSlugs);
  if (!sCheck.valid) return { ok: false };

  const nowIso = new Date().toISOString();

  // Upsert without duplicate rows (INSERT OR REPLACE updates rowid & viewed_at deterministically)
  await db
    .prepare(
      `INSERT OR REPLACE INTO recently_viewed (id, user_id, recipe_slug, viewed_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(generateId(), userId, sCheck.slug, nowIso)
    .run();

  // Keep only the latest 20 viewed recipes for this user
  await db
    .prepare(
      `DELETE FROM recently_viewed
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM recently_viewed
           WHERE user_id = ?
           ORDER BY viewed_at DESC, rowid DESC
           LIMIT ?
         )`,
    )
    .bind(userId, userId, MAX_RECENTLY_VIEWED)
    .run();

  return { ok: true };
}

export async function listRecentlyViewed(
  db: D1Database,
  userId: string,
  limit = MAX_RECENTLY_VIEWED,
): Promise<Array<{ recipeSlug: string; viewedAt: string }>> {
  const safeLimit = Math.max(1, Math.min(limit, MAX_RECENTLY_VIEWED));
  const res = await db
    .prepare(
      `SELECT recipe_slug, viewed_at
       FROM recently_viewed
       WHERE user_id = ?
       ORDER BY viewed_at DESC, rowid DESC
       LIMIT ?`,
    )
    .bind(userId, safeLimit)
    .all<{ recipe_slug: string; viewed_at: string }>();

  return (res.results ?? []).map((r) => ({
    recipeSlug: String(r.recipe_slug),
    viewedAt: String(r.viewed_at),
  }));
}

// ============================================================================
// 4. STAR RATINGS & RECIPE REVIEWS
// ============================================================================

function mapRowToReview(row: Record<string, unknown>): ReviewItem {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    authorDisplayName: String(row.author_display_name ?? 'Community Cook'),
    authorUsername: String(row.author_username ?? 'member'),
    recipeSlug: String(row.recipe_slug),
    rating: Number(row.rating),
    title: String(row.title),
    comment: String(row.comment),
    status: (row.status as ReviewItem['status']) || 'approved',
    moderatedBy: row.moderated_by ? String(row.moderated_by) : null,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Non-destructively converts any existing 'pending' reviews to 'approved'
 * while preserving review content, author information, ratings, and timestamps.
 */
export async function migratePendingReviewsToApproved(
  db: D1Database,
): Promise<{ migratedCount: number }> {
  const res = await db
    .prepare(`UPDATE reviews SET status = 'approved' WHERE status = 'pending'`)
    .run();
  return { migratedCount: Number(res.meta?.changes ?? 0) };
}

export async function submitReview(
  db: D1Database,
  user: SafeUser | null | undefined,
  input: {
    recipeSlug: unknown;
    rating: unknown;
    title: unknown;
    comment: unknown;
  },
  publishedSlugs?: Set<string>,
): Promise<
  | { ok: true; review: ReviewItem; isUpdate: false }
  | { ok: false; error: string; duplicate?: boolean; unauthorized?: boolean }
> {
  if (!user || !user.id) {
    return {
      ok: false,
      error: 'Authentication required. Please sign in to submit a review.',
      unauthorized: true,
    };
  }

  const sCheck = validatePublishedSlug(input.recipeSlug, publishedSlugs);
  if (!sCheck.valid) return { ok: false, error: sCheck.error! };

  const ratingNum = Number(input.rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return { ok: false, error: 'Rating must be a whole number from 1 to 5 stars.' };
  }

  const rawTitle = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  if (rawTitle.length < 3 || rawTitle.length > 120) {
    return { ok: false, error: 'Review title must be between 3 and 120 characters.' };
  }

  const rawComment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (rawComment.length < 10 || rawComment.length > 2000) {
    return { ok: false, error: 'Review comment must be between 10 and 2,000 characters.' };
  }

  const safeTitle = escapeHtml(rawTitle);
  const safeComment = sanitizePlainText(rawComment, 2000);
  const nowIso = new Date().toISOString();

  // Enforce one review per user per recipe and reject duplicate review submissions
  const existing = await db
    .prepare(`SELECT id FROM reviews WHERE user_id = ? AND recipe_slug = ? LIMIT 1`)
    .bind(user.id, sCheck.slug)
    .first<{ id: string }>();

  if (existing) {
    return {
      ok: false,
      error: 'You have already submitted a review for this recipe.',
      duplicate: true,
    };
  }

  const id = generateId();
  try {
    await db
      .prepare(
        `INSERT INTO reviews (
          id, user_id, author_display_name, author_username, recipe_slug,
          rating, title, comment, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
      )
      .bind(id, user.id, user.displayName, user.username, sCheck.slug, ratingNum, safeTitle, safeComment, nowIso, nowIso)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(msg)) {
      return {
        ok: false,
        error: 'You have already submitted a review for this recipe.',
        duplicate: true,
      };
    }
    throw err;
  }

  const created = await db.prepare(`SELECT * FROM reviews WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return { ok: true, review: mapRowToReview(created!), isUpdate: false };
}

export const submitOrUpdateReview = submitReview;

export async function updateOwnReviewById(
  db: D1Database,
  user: SafeUser | null | undefined,
  reviewId: string,
  input: { rating: unknown; title: unknown; comment: unknown },
): Promise<{ ok: true; review: ReviewItem } | { ok: false; error: string; statusCode?: number }> {
  if (!user || !user.id) {
    return {
      ok: false,
      error: 'Authentication required. Please sign in to edit your review.',
      statusCode: 401,
    };
  }

  const cleanId = typeof reviewId === 'string' ? reviewId.trim() : '';
  if (!cleanId) {
    return { ok: false, error: 'Review ID is required.', statusCode: 400 };
  }

  const existing = await db
    .prepare(`SELECT * FROM reviews WHERE id = ? LIMIT 1`)
    .bind(cleanId)
    .first<Record<string, unknown>>();

  if (!existing) {
    return { ok: false, error: 'Review not found.', statusCode: 404 };
  }

  if (String(existing.user_id ?? '') !== user.id) {
    return {
      ok: false,
      error: 'Review not found or you do not have permission to edit it.',
      statusCode: 403,
    };
  }

  const ratingNum = Number(input.rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return { ok: false, error: 'Rating must be a whole number from 1 to 5 stars.', statusCode: 400 };
  }

  const rawTitle = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  if (rawTitle.length < 3 || rawTitle.length > 120) {
    return { ok: false, error: 'Review title must be between 3 and 120 characters.', statusCode: 400 };
  }

  const rawComment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (rawComment.length < 10 || rawComment.length > 2000) {
    return { ok: false, error: 'Review comment must be between 10 and 2,000 characters.', statusCode: 400 };
  }

  const safeTitle = escapeHtml(rawTitle);
  const safeComment = sanitizePlainText(rawComment, 2000);
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `UPDATE reviews
       SET rating = ?, title = ?, comment = ?, author_display_name = ?, author_username = ?,
           status = 'approved', updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(ratingNum, safeTitle, safeComment, user.displayName, user.username, nowIso, cleanId, user.id)
    .run();

  const updated = await db.prepare(`SELECT * FROM reviews WHERE id = ?`).bind(cleanId).first<Record<string, unknown>>();
  return { ok: true, review: mapRowToReview(updated!) };
}

export async function deleteOwnReview(
  db: D1Database,
  userId: string | null | undefined,
  reviewId: string,
): Promise<{ ok: true } | { ok: false; error: string; statusCode?: number }> {
  if (!userId || typeof userId !== 'string') {
    return {
      ok: false,
      error: 'Authentication required. Please sign in to delete your review.',
      statusCode: 401,
    };
  }

  const cleanId = typeof reviewId === 'string' ? reviewId.trim() : '';
  if (!cleanId) {
    return { ok: false, error: 'Review ID is required.', statusCode: 400 };
  }

  const existing = await db
    .prepare(`SELECT id, user_id FROM reviews WHERE id = ? LIMIT 1`)
    .bind(cleanId)
    .first<{ id: string; user_id: string | null }>();

  if (!existing) {
    return { ok: false, error: 'Review not found.', statusCode: 404 };
  }

  if (String(existing.user_id ?? '') !== userId) {
    return {
      ok: false,
      error: 'Review not found or you do not have permission to delete it.',
      statusCode: 403,
    };
  }

  await db.prepare(`DELETE FROM reviews WHERE id = ? AND user_id = ?`).bind(cleanId, userId).run();
  return { ok: true };
}

export async function getPublicRecipeReviews(
  db: D1Database,
  recipeSlug: string,
  page = 1,
  pageSize = 10,
  currentUserId?: string | null,
): Promise<PublicRecipeReviewStats> {
  const cleanSlug = normalizeSlug(recipeSlug);
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 10)));
  const offset = (safePage - 1) * safePageSize;

  // Aggregate strictly over approved reviews
  const distRes = await db
    .prepare(
      `SELECT rating, COUNT(*) AS cnt
       FROM reviews
       WHERE recipe_slug = ? AND status = 'approved'
       GROUP BY rating`,
    )
    .bind(cleanSlug)
    .all<{ rating: number; cnt: number }>();

  const distribution: { 1: number; 2: number; 3: number; 4: number; 5: number } = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let totalApproved = 0;
  let weightedSum = 0;

  for (const r of distRes.results ?? []) {
    const star = Number(r.rating) as 1 | 2 | 3 | 4 | 5;
    const count = Number(r.cnt);
    if (star >= 1 && star <= 5) {
      distribution[star] = count;
      totalApproved += count;
      weightedSum += star * count;
    }
  }

  const averageRating = totalApproved > 0 ? Math.round((weightedSum / totalApproved) * 10) / 10 : 0;

  // Paginated approved reviews
  const approvedRes = await db
    .prepare(
      `SELECT *
       FROM reviews
       WHERE recipe_slug = ? AND status = 'approved'
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(cleanSlug, safePageSize, offset)
    .all<Record<string, unknown>>();

  const reviews = (approvedRes.results ?? []).map(mapRowToReview).map((rev) => ({
    ...rev,
    userId: currentUserId && rev.userId === currentUserId ? rev.userId : null, // Do not expose other users' internal IDs publicly
  }));

  let myReview: ReviewItem | null = null;
  if (currentUserId) {
    const own = await db
      .prepare(`SELECT * FROM reviews WHERE recipe_slug = ? AND user_id = ? LIMIT 1`)
      .bind(cleanSlug, currentUserId)
      .first<Record<string, unknown>>();
    if (own) {
      myReview = mapRowToReview(own);
    }
  }

  return {
    recipeSlug: cleanSlug,
    averageRating,
    totalApproved,
    distribution,
    reviews,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(totalApproved / safePageSize)),
    myReview,
  };
}

export async function listUserReviews(
  db: D1Database,
  userId: string,
): Promise<ReviewItem[]> {
  const res = await db
    .prepare(`SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<Record<string, unknown>>();

  return (res.results ?? []).map(mapRowToReview);
}

// ============================================================================
// 5. ADMIN REVIEW MANAGEMENT (SEARCH, FILTER & DELETE)
// ============================================================================

export async function listAdminReviews(
  db: D1Database,
  filters: {
    recipeSlug?: string;
    rating?: number;
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{
  reviews: ReviewItem[];
  counts: { approved: number; total: number };
  page: number;
  totalPages: number;
}> {
  const countRes = await db
    .prepare(`SELECT status, COUNT(*) AS cnt FROM reviews GROUP BY status`)
    .all<{ status: string; cnt: number }>();

  const counts = { approved: 0, total: 0 };
  for (const row of countRes.results ?? []) {
    const c = Number(row.cnt);
    counts.total += c;
    if (row.status === 'approved') counts.approved = c;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.recipeSlug && filters.recipeSlug.trim()) {
    conditions.push(`recipe_slug = ?`);
    params.push(filters.recipeSlug.trim().toLowerCase());
  }
  const ratingFilter = Number(filters.rating);
  if (Number.isInteger(ratingFilter) && ratingFilter >= 1 && ratingFilter <= 5) {
    conditions.push(`rating = ?`);
    params.push(ratingFilter);
  }
  if (filters.q && filters.q.trim()) {
    const like = `%${filters.q.trim().toLowerCase()}%`;
    conditions.push(
      `(LOWER(title) LIKE ? OR LOWER(comment) LIKE ? OR LOWER(author_display_name) LIKE ? OR LOWER(author_username) LIKE ? OR LOWER(recipe_slug) LIKE ?)`,
    );
    params.push(like, like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safePage = Math.max(1, Math.floor(Number(filters.page) || 1));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number(filters.pageSize) || 25)));
  const offset = (safePage - 1) * safePageSize;

  const totalMatchingRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM reviews ${whereClause}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const totalMatching = Number(totalMatchingRow?.cnt ?? 0);

  const rowsRes = await db
    .prepare(
      `SELECT * FROM reviews ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...params, safePageSize, offset)
    .all<Record<string, unknown>>();

  return {
    reviews: (rowsRes.results ?? []).map(mapRowToReview),
    counts,
    page: safePage,
    totalPages: Math.max(1, Math.ceil(totalMatching / safePageSize)),
  };
}

export const listModerationReviews = listAdminReviews;

export async function adminDeleteReview(
  db: D1Database,
  reviewId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db.prepare(`SELECT id FROM reviews WHERE id = ? LIMIT 1`).bind(reviewId).first();
  if (!existing) {
    return { ok: false, error: 'Review not found.' };
  }

  await db.prepare(`DELETE FROM reviews WHERE id = ?`).bind(reviewId).run();
  return { ok: true };
}
