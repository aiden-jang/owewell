/**
 * Makes tsc aware of jest-dom's matchers (toBeInTheDocument, toBeDisabled, ...).
 *
 * The runtime registration lives in test/setup.ts, but tsconfig only includes `src`, so without this
 * the matchers work at runtime and fail the typecheck — tests green, `tsc --noEmit` red.
 */
import '@testing-library/jest-dom/vitest';
