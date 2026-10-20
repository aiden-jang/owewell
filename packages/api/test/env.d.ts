import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env } from '../src/env.js';

declare global {
  namespace Cloudflare {
    // Bindings the test worker sees: the app's own Env plus the migrations we inject.
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

type AppEnv = Env;
