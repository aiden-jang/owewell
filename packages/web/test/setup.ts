import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Register on the same workspace runner used by the tests, independent of hoisting.
expect.extend(matchers);

/**
 * Unmount between tests.
 *
 * @testing-library/react only auto-registers this when the test framework's globals are enabled, and
 * they are not here. Without it every render stacks up in the same document, so the second test onward
 * sees two dashboards and every getByRole throws "found multiple elements" — which reads exactly like
 * a bug in the component rather than in the harness.
 */
afterEach(cleanup);
