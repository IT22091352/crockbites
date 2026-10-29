/**
 * Cloudflare Pages/Workers expose secrets through runtime bindings, not process.env or import.meta.env.
 * The middleware calls this once per isolate so getRuntimeSecret() (admin.ts) can read them.
 * Outside Cloudflare (plain Node, tests) the import fails and local .env values are used instead.
 */
let attempted = false;

export async function loadRuntimeEnv() {
  if (attempted) return;
  attempted = true;
  try {
    // Dynamically import cloudflare:workers in production Cloudflare runtime
    // @ts-ignore
    const mod = await import('cloudflare:workers');
    (globalThis as unknown as { __CROCKBITES_ENV__?: unknown }).__CROCKBITES_ENV__ = mod.env;
  } catch {
    // Not running on Cloudflare; local environment variables are used.
  }
}

