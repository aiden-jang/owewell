import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// The maintained plugin shares storage; reset the ledger before each test, preserving its schema.
beforeEach(async () => {
  await env.DB.exec('DELETE FROM groups');
  await env.DB.exec('DELETE FROM people');
});
