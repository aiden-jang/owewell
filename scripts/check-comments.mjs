/*
 * Two checks on comments, run by `pnpm run verify`.
 *
 * A ceiling, because a cleanup pass is a moment and drift is permanent. And a stranded check,
 * because moving code leaves its comment behind describing something that is no longer underneath
 * it: `itemSplitHint` moved into its own component and its comment stayed on the page above a name
 * lookup it has nothing to do with.
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
const stranded = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  totalLines += source.split('\n').filter((l) => l.trim() !== '').length;
  for (const c of comments(source)) {
    commentLines += c.lines;
  }

  const lines = source.split('\n');
  let afterDeclaration = false;
  for (let i = 1; i < lines.length - 2; i++) {
    if (/^\}\)?;?$/.test(lines[i])) afterDeclaration = true;
    /*
     * A comment, then a blank line, then a declaration. A file header sits above the first one of
     * those and is fine, so is a section divider; a paragraph floating above an unrelated export
     * further down is one whose subject moved without it.
     */
    const ends = /^\s*(\/\/|\*\/)/.test(lines[i]) && !/^\s*\/\/\s*-{3,}/.test(lines[i]);
    const next = lines.slice(i + 2, i + 4).find((l) => l.trim()) ?? '';
    if (
      afterDeclaration &&
      ends &&
      lines[i + 1].trim() === '' &&
      /^(export |const |function )/.test(next.trim())
    ) {
      stranded.push(
        `${file}:${i + 1} — "${lines[i].trim().slice(0, 56)}…" then a gap, then ${next.trim().slice(0, 36)}`,
      );
    }

    /*
     * A doc block with nothing under it but a closing brace. `/**` exists to describe the next
     * declaration, so one describing a brace is documenting a prop or a field that has been removed.
     */
    if (!/\*\/\s*$/.test(lines[i])) continue;
    let open = i;
    while (open >= 0 && !lines[open].includes('/*')) open--;
    const after = lines.slice(i + 1).find((l) => l.trim()) ?? '';
    if (open >= 0 && lines[open].includes('/**') && /^[)}\]]/.test(after.trim())) {
      const quoted = (open === i ? lines[open] : lines[open + 1]) ?? '';
      stranded.push(
        `${file}:${open + 1} — a doc block with nothing under it: "${quoted.trim().slice(0, 56)}…"`,
      );
    }
  }
}

const problems = stranded.map((s) => `a comment left behind by a move: ${s}`);
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
  `comments ok: ${(density * 100).toFixed(2)}% of ${totalLines} lines ` +
    `(${commentLines}/${ceiling}), none stranded`,
);
