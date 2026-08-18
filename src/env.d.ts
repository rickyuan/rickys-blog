/// <reference path="../.astro/types.d.ts" />

// Astro 6 + @astrojs/cloudflare v13: bindings are accessed via
// `import { env } from 'cloudflare:workers'` (Astro.locals.runtime was removed).
// We type just the bindings this site uses.
declare module 'cloudflare:workers' {
  export const env: {
    DB: import('./lib/d1-types').D1Database;
  };
}
