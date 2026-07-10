import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test worker (before the isolated-storage snapshot each test starts from),
// so every test sees the full schema but its own writes roll back afterward.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
