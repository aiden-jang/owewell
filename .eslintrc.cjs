module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    '.wrangler',
    'test-results',
    'playwright-report',
    'coverage',
    '*.config.ts',
    '*.config.js',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // An error, not a warning, and the reason is specific: a useEffect in GroupDetailPage sat below
    // the component's early returns, so the first render (group still loading) ran one fewer hook
    // than the render after it. React throws #310 for that, and it took out every group page in
    // production the instant its data arrived. Nothing in typecheck, build or the test suite could
    // see it. This rule sees it statically, and CI runs lint before it deploys.
    'react-hooks/rules-of-hooks': 'error',
    // Warn only. Exhaustive deps is a genuine judgement call often enough that erroring on it would
    // train everyone to disable the line, which would take rules-of-hooks down with it.
    'react-hooks/exhaustive-deps': 'warn',
  },
};
