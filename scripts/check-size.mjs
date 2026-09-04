/*
 * Ceilings on file length and component state, run by `pnpm run verify`.
 *
 * Nothing else here notices a file growing, and a god-file is never added. It accretes twenty
 * lines at a time and no single diff looks wrong, which is how the routes for one resource reached
 * 910 lines and one page reached fourteen pieces of state.
 *
 * 500 is not arbitrary: nine files in ten are under 382 lines, so the ceiling sits above the shape
 * of the codebase rather than cutting through the middle of it. Lines are the proxy; the state
 * count is the signal. Splitting the file is almost always the right answer to a failure here.
 */
import { globSync, readFileSync } from 'node:fs';

const MAX_LINES = 500;
const MAX_STATE = 12;

/*
 * Already over, and being decomposed. Listed at their size on the day the gate went in rather than
 * the ceiling being raised for everyone, so nothing else can grow past 500 meanwhile. Shrink an
 * entry as the file shrinks; delete it once the file is under the ceiling.
 */
const ALREADY_OVER = {
  'packages/web/src/pages/QuickSplitPage.tsx': { lines: 861 },
  'packages/web/src/pages/GroupDetailPage.tsx': { lines: 798 },
  'packages/api/src/groups.ts': { lines: 684 },
  'packages/web/src/pages/DashboardPage.tsx': { lines: 578, state: 14 },
  'packages/api/src/index.ts': { lines: 568 },
};

const files = globSync('packages/*/src/**/*.{ts,tsx}').filter((f) => !/\.test\.tsx?$/.test(f));
const problems = [];
let widest = { lines: 0, file: '' };
let busiest = { state: 0, file: '' };

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // Counted the way `wc -l` counts, so the number here is the number a person reads off the file.
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  // useState in a component, not every hook: a count of these is how much one file is keeping
  // track of at once.
  const state = (source.match(/\buseState[(<]/g) ?? []).length;
  const allowed = ALREADY_OVER[file] ?? {};
  const lineCap = allowed.lines ?? MAX_LINES;
  const stateCap = allowed.state ?? MAX_STATE;

  if (lines > lineCap) problems.push(`${file} is ${lines} lines, over ${lineCap}`);
  if (state > stateCap) problems.push(`${file} holds ${state} pieces of state, over ${stateCap}`);
  if (lines > widest.lines) widest = { lines, file };
  if (state > busiest.state) busiest = { state, file };
}

for (const file of Object.keys(ALREADY_OVER)) {
  if (!files.includes(file)) problems.push(`${file} is listed as being decomposed but does not exist`);
}

if (problems.length > 0) {
  console.error('size check failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

const decomposing = Object.keys(ALREADY_OVER).length;
console.log(
  `size ok: ceiling ${MAX_LINES} lines / ${MAX_STATE} state` +
    (decomposing > 0 ? `, with ${decomposing} file(s) still being decomposed` : ''),
);
