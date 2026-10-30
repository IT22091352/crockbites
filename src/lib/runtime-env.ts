/**
 * Cloudflare Pages/Workers expose secrets and bindings (D1, KV) through runtime bindings (`cloudflare:workers`),
 * not process.env or import.meta.env.
 * The middleware and database layer call this so getRuntimeSecret() and getDb() can read them reliably.
 * Outside Cloudflare (plain Node, unit tests) the import fails and local .env values are used instead.
 */
let cfModCache: { env?: Record<string, unknown> } | null = null;
let attempted = false;

export async function loadRuntimeEnv(): Promise<Record<string, unknown> | undefined> {
  if (!attempted) {
    attempted = true;
    try {
      // @ts-ignore - virtual module provided by Cloudflare Workers / workerd runtime
      cfModCache = await import('cloudflare:workers');
    } catch {
      cfModCache = null;
    }
  }

  if (cfModCache?.env) {
    (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__ = cfModCache.env;
    return cfModCache.env;
  }

  return (globalThis as unknown as { __CROCKBITES_ENV__?: Record<string, unknown> }).__CROCKBITES_ENV__;
}
