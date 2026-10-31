// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://crockbites.site',
  output: 'static',
  adapter: cloudflare({
    sessionKVBindingName: 'RATE_LIMIT_KV',
  }),
  trailingSlash: 'always',
  build: { format: 'directory' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  vite: { plugins: [tailwindcss()] },
});
