// Check comment budgets, repeated explanations, and comments stranded by moves.
import { globSync, readFileSync } from 'node:fs';

const MAX_SRC_DENSITY = 0.17;
/*
 * The gates' own source counts too, at a higher rate than src because a gate's header is mostly
 * the reason it exists. A check that does not cover itself stops being checked, and a ceiling
 * comment is exactly where a changelog quietly accumulates.
 */
const SCRIPTS_CEILING = 0.25;

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

const src = globSync('packages/*/src/**/*.{ts,tsx,css}').filter((f) => !/\.test\.tsx?$/.test(f));
const own = [...globSync('scripts/*.mjs'), ...globSync('packages/*/scripts/*.mjs')];
const files = [...src, ...own];

let commentLines = 0;
let totalLines = 0;
let scriptComments = 0;
let scriptTotal = 0;
const stranded = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const nonBlank = source.split('\n').filter((l) => l.trim() !== '').length;
  const isOwn = own.includes(file);
  if (isOwn) scriptTotal += nonBlank;
  else totalLines += nonBlank;
  for (const c of comments(source)) {
    if (isOwn) scriptComments += c.lines;
    else commentLines += c.lines;
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

const scriptsAllowed = Math.floor(scriptTotal * SCRIPTS_CEILING);
if (scriptComments > scriptsAllowed) {
  problems.push(
    `scripts are ${((scriptComments / scriptTotal) * 100).toFixed(1)}% comments, over the ` +
      `${(SCRIPTS_CEILING * 100).toFixed(0)}% ceiling (${scriptComments} lines, ${scriptsAllowed} allowed).`,
  );
}

if (problems.length > 0) {
  console.error('comment check failed:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `comments ok: src ${(density * 100).toFixed(2)}% of ${totalLines} lines (${commentLines}/${ceiling}), ` +
    `scripts ${((scriptComments / scriptTotal) * 100).toFixed(1)}%, none stranded`,
);
