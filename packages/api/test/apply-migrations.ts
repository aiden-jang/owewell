import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test worker, so every test sees the full production schema rather than whatever
// the last one happened to leave behind.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
