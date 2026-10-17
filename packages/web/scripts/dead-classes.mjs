// Check referenced classes against the built CSS, including generated utilities.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'dist/assets');

/*
 * The stylesheet index.html actually links, not the first .css in the folder.
 *
 * dist/assets is not cleaned between builds in every setup, and picking `.find(f => f.endsWith
 * ('.css'))` out of a directory that has accumulated several means auditing a stale file and
 * reporting "no dead classes" about a build nobody is running.
 */
let cssFile;
try {
  const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  cssFile = /assets\/([^"']+\.css)/.exec(html)?.[1];
} catch {
  console.error('No dist/ found. Run the build first:\n  pnpm --filter @owewell/web build');
  process.exit(2);
}
if (!cssFile) {
  console.error('dist/index.html links no stylesheet. Did the build finish?');
  process.exit(2);
}
const css = readFileSync(join(ASSETS, cssFile), 'utf8');

// Selectors come out escaped (`.hover\:bg-card`, `.pb-\[1rem\]`); unescaping returns the source token.
const emitted = new Set();
for (const m of css.matchAll(/\.((?:\\.|[^\\\s.,:>~+()[\]{}'"#])+)/g)) {
  emitted.add(m[1].replace(/\\(.)/g, '$1'));
}

function sources(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const used = new Map();
for (const file of sources(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    // The literal text, plus every quoted string inside a ${...} — that is where the conditional
    // classes live. Operands of a comparison are skipped: `x === 'helpful'` is not a class list.
    const chunks = [raw.replace(/\$\{[^}]*\}/g, ' ')];
    for (const lit of raw.matchAll(/(!==|===)?\s*'([^']*)'/g)) if (!lit[1]) chunks.push(lit[2]);
    for (const chunk of chunks) {
      for (const token of chunk.split(/\s+/)) {
        if (!token || token.includes('$') || token.includes('{')) continue;
        if (!used.has(token)) used.set(token, new Set());
        used.get(token).add(file.slice(ROOT.length + 5));
      }
    }
  }
}

const dead = [...used].filter(([token]) => !emitted.has(token)).sort();
if (dead.length === 0) {
  console.log(`No dead classes. ${used.size} tokens used, all present in ${cssFile}.`);
  process.exit(0);
}
console.error(`${dead.length} class name(s) produce no CSS:\n`);
for (const [token, files] of dead) console.error(`  ${token.padEnd(36)} ${[...files].sort().join(', ')}`);
process.exit(1);
