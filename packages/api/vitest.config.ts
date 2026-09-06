import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Read the same migrations wrangler applies, and hand them to the test worker so each run
// starts against a real (in-memory) D1 with the production schema.
// Absolute, not './migrations': knip loads this config from the repo root, and a relative
// path resolves against the caller's directory rather than this one.
const migrations = await readD1Migrations(join(import.meta.dirname, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    name: 'api',
    exclude: ['**/node_modules/**'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
