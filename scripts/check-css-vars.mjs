#!/usr/bin/env node
/*
 * Fails the build when a `var(--x)` names a custom property nothing declares.
 *
 * This failure mode is silent by construction: with a fallback the rule quietly uses the fallback,
 * and without one `color` inherits while `fill` renders black. Six of these shipped before the
 * check existed, and every one was found by accident.
 *
 * A fallback does not make a reference legitimate, so a reference is reported either way.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'packages/web/src');

/* Properties set by something this scan cannot see. An entry here is a promise that some runtime
   really does set it. */
const EXTERNAL = new Set([]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(css|ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const declared = new Set(EXTERNAL);
const references = [];

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  const isStyleSheet = file.endsWith('.css');

  if (isStyleSheet) {
    // `--x:` opening a declaration, and `@property --x { }` which registers one.
    for (const m of source.matchAll(/(?:^|[;{}\s])(--[\w-]+)\s*:/g)) declared.add(m[1]);
    for (const m of source.matchAll(/@property\s+(--[\w-]+)/g)) declared.add(m[1]);
  } else {
    /* In TS a property is declared as a style key or a setProperty argument, both bare string
       literals. Match the whole literal, or `'var(--chip-edge)'` counts as a declaration. */
    for (const m of source.matchAll(/['"`](--[\w-]+)['"`]/g)) declared.add(m[1]);
  }

  /*
   * Comments masked first. A note explaining what `var(--x)` does is prose, and counting it as a
   * reference means the gate reports a property nobody meant to use.
   */
  const live = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  for (const m of live.matchAll(/var\(\s*(--[\w-]+)/g)) {
    /*
     * A name broken by an interpolation is built at runtime, so there is nothing here to check
     * against: `var(--p-cat-${key})` matches as `--p-cat-` and no such property is ever declared.
     */
    if (live[m.index + m[0].length] === '$') continue;
    references.push({
      name: m[1],
      file: relative(ROOT, file),
      line: source.slice(0, m.index).split('\n').length,
    });
  }
}

const undefinedRefs = references.filter((r) => !declared.has(r.name));

if (undefinedRefs.length === 0) {
  const unique = new Set(references.map((r) => r.name)).size;
  console.log(`css-vars: ${references.length} references to ${unique} custom properties, all declared.`);
  process.exit(0);
}

const byName = new Map();
for (const ref of undefinedRefs) {
  if (!byName.has(ref.name)) byName.set(ref.name, []);
  byName.get(ref.name).push(ref);
}

console.error(
  `css-vars: ${byName.size} custom ${byName.size === 1 ? 'property is' : 'properties are'} referenced but never declared.\n`,
);
for (const [name, refs] of byName) {
  console.error(`  ${name}`);
  for (const ref of refs) console.error(`    ${ref.file}:${ref.line}`);
}
console.error('\nDeclare it (index.css holds the palette), or fix the name at the reference.');
process.exit(1);
