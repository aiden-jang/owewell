import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Read the same migrations wrangler applies, and hand them to the test worker so each run
// starts against a real (in-memory) D1 with the production schema.
const migrations = await readD1Migrations('./migrations');

export default defineWorkersConfig({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      },
    },
  },
});
