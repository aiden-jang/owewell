import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests, in a real browser against the real Worker and a real local D1.
 *
 * This is the layer nothing else in this repo can see. The api tests know the ledger nets to zero
 * and the web unit tests know a component renders; neither knows whether a person can get from an
 * empty account to a group with an expense in it and a balance that reads correctly.
 *
 * Three servers, because that is what the app is: the SPA, the Worker, and the shared auth service
 * the Worker asks about the session. The first two are the real thing. Auth is a stub, because the
 * session is checked server-side and there is no seam in the browser to intercept it, and because
 * these tests are about owewell's screens rather than about signing in.
 *
 * Migrations run against the local D1 before the Worker starts, in the same order production does
 * it, so a schema change that nobody applied fails here rather than after a deploy.
 */
const AUTH_PORT = 34199;
const API_PORT = 34200;
const WEB_PORT = 30001;
const STATE = '.wrangler/e2e-state';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial: one Worker and one local D1 are shared, and the point here is one person's journey
  // rather than throughput.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node e2e/fake-auth.mjs`,
      port: AUTH_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    {
      /*
       * Its own state directory, not the one `pnpm run dev:api` uses. Sharing it meant every run
       * left its groups and expenses in the database somebody develops against, and the suite
       * quietly depended on whatever the last run had done.
       */
      command:
        `pnpm exec wrangler d1 migrations apply owewell --local --persist-to ${STATE} && ` +
        `pnpm exec wrangler dev --persist-to ${STATE} ` +
        `--var AUTH_URL:http://localhost:${AUTH_PORT} --port ${API_PORT}`,
      cwd: '../api',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: `pnpm run dev`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
    },
  ],
});
