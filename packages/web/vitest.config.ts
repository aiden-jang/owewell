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
  },
});
