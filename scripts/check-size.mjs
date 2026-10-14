// Keep modules bounded and reduce existing exceptions as their responsibilities move.
import { globSync, readFileSync } from 'node:fs';

const MAX_LINES = 400;
const MAX_STATE = 12;

const files = [
  ...globSync('packages/*/src/**/*.{ts,tsx}'),
  ...globSync('scripts/*.mjs'),
  ...globSync('packages/*/scripts/*.mjs'),
].filter((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
const problems = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // Counted the way `wc -l` counts, so the number here is the number a person reads off the file.
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  // useState in a component, not every hook: a count of these is how much one file is keeping
  // track of at once.
  const state = (source.match(/\buseState[(<]/g) ?? []).length;
  if (lines > MAX_LINES) problems.push(`${file} is ${lines} lines, over ${MAX_LINES}`);
  if (state > MAX_STATE) problems.push(`${file} holds ${state} pieces of state, over ${MAX_STATE}`);
}

if (problems.length > 0) {
  console.error('size check failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`size ok: ${files.length} modules checked, ceiling ${MAX_LINES} lines / ${MAX_STATE} state`);
