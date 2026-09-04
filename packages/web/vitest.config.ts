import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Two kinds of test live here, so the environment is per-file.
 *
 * Most of `src/lib` is pure logic and runs fastest with no DOM at all. The component tests need one,
 * and they exist because the dashboard's bugs are interaction bugs: two modes that could both be open
 * at once, and a button that silently did nothing. Neither is visible to a typecheck, and neither can
 * be checked without signing in — which is exactly the kind of verification that should not depend on
 * a human being available.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // .ts as well as .tsx: not every test that needs a DOM renders a component. The outbox needs
    // localStorage and navigator.onLine and has no JSX in it at all.
    environmentMatchGlobs: [['src/**/*.dom.test.{ts,tsx}', 'jsdom']],
    setupFiles: ['./test/setup.ts'],
    // e2e/ belongs to Playwright. Vitest picking those up gets as far as `test.describe` and then
    // reports two copies of @playwright/test, which is a confusing way to say "wrong runner".
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    /*
     * A fixed zone, west of UTC on purpose.
     *
     * An expense's date is a calendar day stored at UTC midnight, so every bug in handling it is
     * invisible from UTC and shows up everywhere else. CI runs in UTC and this machine does not,
     * which is the worst of both: pinning one zone means the date tests assert the same thing in
     * both places, and the one they assert is the one real users are in.
     */
    env: { TZ: 'America/New_York' },
  },
});
