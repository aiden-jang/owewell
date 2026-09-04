/*
 * A ceiling on comments, run by `pnpm run verify`, because a cleanup pass is a moment and drift
 * is permanent.
 *
 * The ceiling is a share of the code rather than a line count. A count charges a new module for
 * its own header, so it blocks a genuine explanation exactly as hard as it blocks padding.
 *
 * 17% is high next to other repos here and that is deliberate: these comments were read before the
 * number was set, and they are mostly design rules with the bug that prompted them attached — why
 * an empty state must not look like a failure, why a category is a glyph in a list and a dot in a
 * chart, why localhost is safe to allow past the CSRF check. None of that is recoverable from the
 * code. What this catches is prose added to code that already exists: three hundred lines of it
 * with no new code trips the ceiling, a new module documented at this rate does not.
 */
import { globSync, readFileSync } from 'node:fs';

const MAX_SRC_DENSITY = 0.17;

/** Comment spans in one file, with string literals blanked first. */
function comments(source) {
  /*
   * A route path or glob holding `/*` would otherwise open a block comment that swallows the code
   * after it, and the count comes out high for a reason nobody can see. Masking strings first is
   * cheaper than parsing.
   */
  const masked = source.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) =>
    ' '.repeat(m.length),
  );
  const out = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const text = source.slice(m.index, m.index + m[0].length);
    out.push({ text, lines: m[0].split('\n').length });
  }
  return out;
}

const files = globSync('packages/*/src/**/*.{ts,tsx,css}').filter((f) => !/\.test\.tsx?$/.test(f));

let commentLines = 0;
let totalLines = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  totalLines += source.split('\n').filter((l) => l.trim() !== '').length;
  for (const c of comments(source)) {
    commentLines += c.lines;
  }
}

const problems = [];
const density = totalLines === 0 ? 0 : commentLines / totalLines;
const ceiling = Math.floor(totalLines * MAX_SRC_DENSITY);

if (commentLines > ceiling) {
  problems.push(
    `src is ${(density * 100).toFixed(2)}% comments, over the ${(MAX_SRC_DENSITY * 100).toFixed(0)}% ceiling ` +
      `(${commentLines} lines, ${ceiling} allowed at ${totalLines} lines of source).`,
  );
}

if (problems.length > 0) {
  console.error('comment check failed:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `comments ok: ${(density * 100).toFixed(2)}% of ${totalLines} lines ` + `(${commentLines}/${ceiling})`,
);
