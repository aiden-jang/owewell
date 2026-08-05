import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Unmount between tests.
 *
 * @testing-library/react only auto-registers this when the test framework's globals are enabled, and
 * they are not here. Without it every render stacks up in the same document, so the second test onward
 * sees two dashboards and every getByRole throws "found multiple elements" — which reads exactly like
 * a bug in the component rather than in the harness.
 */
afterEach(cleanup);
