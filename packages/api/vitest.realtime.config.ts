import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/realtime.test.ts'],
    name: 'realtime',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // See vitest.workspace.ts: a room holding a socket cannot be snapshotted.
        isolatedStorage: false,
      },
    },
  },
});
