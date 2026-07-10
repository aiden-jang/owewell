import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Env } from '../src/env.js';

declare module 'cloudflare:test' {
  // Bindings the test worker sees: the app's own Env plus the migrations we inject.
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
