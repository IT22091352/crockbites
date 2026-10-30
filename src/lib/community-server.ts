import { getAllRecipes, recipeSlug, type Recipe } from '../utils/recipes';
import { getD1BindingStatus, getDb, type D1Database } from './db';
import {
  USER_CSRF_COOKIE,
  USER_SESSION_COOKIE,
  createUserCsrfToken,
  getAuthenticatedUser,
  verifyUserCsrfToken,
  type SafeUser,
} from './user-auth';

/**
 * Safe server-side diagnostic logger for Cloudflare Workers / Pages.
 * Logs structured error context without ever exposing passwords, tokens, cookies, secrets, or PII.
 */
export function logServerDiagnostic(stage: string, err: unknown, extra: Record<string, unknown> = {}): void {
  const d1Status = getD1BindingStatus();
  console.error('[CrockBites Auth/Community Diagnostic]', {
    stage,
    d1Mode: d1Status.mode,
    isD1Bound: d1Status.isD1Bound,
    errorName: err instanceof Error ? err.name : 'UnknownError',
    errorMessage: err instanceof Error ? err.message : String(err),
    ...extra,
  });
}

export const PRIVATE_JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store, no-cache, must-revalidate',
};

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...PRIVATE_JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

export async function getPublishedRecipesMap(): Promise<{
  recipes: Recipe[];
  bySlug: Map<string, Recipe>;
  slugSet: Set<string>;
}> {
  const recipes = await getAllRecipes(false); // Strictly published (reviewStatus === 'tested')
  const bySlug = new Map<string, Recipe>();
  const slugSet = new Set<string>();
  for (const r of recipes) {
    const s = recipeSlug(r).toLowerCase();
    bySlug.set(s, r);
    slugSet.add(s);
  }
  return { recipes, bySlug, slugSet };
}

export async function resolveUserSession(
  cookies: any,
  locals?: any,
  urlProtocol = 'https:',
): Promise<{
  db: D1Database | null;
  user: SafeUser | null;
  sessionToken: string;
  csrfToken: string;
}> {
  let db: D1Database | null = null;
  let user: SafeUser | null = null;
  const sessionToken = cookies.get(USER_SESSION_COOKIE)?.value ?? '';

  try {
    db = await getDb(locals);
    if (db && sessionToken) {
      user = await getAuthenticatedUser(db, sessionToken);
    }
  } catch (err) {
    logServerDiagnostic('resolveUserSession', err, {
      hasSessionCookie: Boolean(sessionToken),
    });
    throw err;
  }

  if (sessionToken && !user) {
    cookies.delete(USER_SESSION_COOKIE, { path: '/' });
    cookies.delete(USER_CSRF_COOKIE, { path: '/' });
  }

  const csrfContext = user && sessionToken ? sessionToken : 'guest';
  const csrfToken = createUserCsrfToken(csrfContext);
  const existingCsrf = cookies.get(USER_CSRF_COOKIE)?.value;
  if (existingCsrf !== csrfToken) {
    cookies.set(USER_CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: urlProtocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return {
    db,
    user,
    sessionToken: user ? sessionToken : '',
    csrfToken,
  };
}

export async function requireAuthenticatedUserApi(
  request: Request,
  cookies: any,
  locals?: any,
  requireCsrf = true,
): Promise<
  | { ok: true; db: D1Database; user: SafeUser; sessionToken: string; csrfToken: string }
  | { ok: false; response: Response }
> {
  const db = await getDb(locals);
  if (!db) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            'Community database (Cloudflare D1 binding "DB") is not configured in this environment.',
        },
        503,
      ),
    };
  }

  const sessionToken = cookies.get(USER_SESSION_COOKIE)?.value ?? '';
  const user = await getAuthenticatedUser(db, sessionToken);
  if (!user || !sessionToken) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Authentication required. Please sign in.' }, 401),
    };
  }

  if (requireCsrf && request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    const csrfCookie = cookies.get(USER_CSRF_COOKIE)?.value;
    const validCsrf = await verifyUserCsrfToken(request, csrfCookie, sessionToken);
    if (!validCsrf) {
      return {
        ok: false,
        response: jsonResponse({ error: 'Security check (CSRF) failed. Please refresh the page and try again.' }, 403),
      };
    }
  }

  return {
    ok: true,
    db,
    user,
    sessionToken,
    csrfToken: createUserCsrfToken(sessionToken),
  };
}

