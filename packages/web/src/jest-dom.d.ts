import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import 'vitest';

// Resolve Vitest from this workspace: jest-dom's own augmentation can resolve a different
// hoisted version when multiple runners share the lockfile. Runtime setup stays in test/setup.ts.
declare module 'vitest' {
  // Match Vitest's generic default so the declarations merge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
