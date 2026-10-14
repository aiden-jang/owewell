import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The skip link points at #main, so every page has to have one.
 *
 * This is the way a skip link rots: someone adds a page, writes a plain <main> or a <div>, and the
 * link silently becomes a no-op on that route. Nothing fails — the fragment just doesn't resolve,
 * and the only person who finds out is the one navigating by keyboard.
 *
 * Read off the source rather than rendered, because rendering five pages needs five sets of API
 * mocks to assert one attribute, and the attribute is what matters.
 */

const PAGES = resolve(process.cwd(), 'src/pages');

/** Comments stripped first: GroupDetailPage discusses "<main>" in prose, and prose is not markup. */
const withoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function reachableMainTags(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = withoutComments(readFileSync(file, 'utf8'));
  const direct = source.match(/<main\b[^>]*>/g) ?? [];
  if (direct.length) return direct;
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].flatMap((match) => {
    if (!match[1]!.startsWith('.')) return [];
    const component = resolve(dirname(file), match[1]!.replace(/\.[jt]sx?$/, '') + '.tsx');
    return existsSync(component) ? reachableMainTags(component, seen) : [];
  });
}

const pageSources = readdirSync(PAGES)
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
  .map((file) => [file, reachableMainTags(join(PAGES, file))] as const);

describe('the skip target', () => {
  it('finds a page to check', () => {
    expect(pageSources.length).toBeGreaterThan(3);
  });

  it.each(pageSources)('%s opens a <main> the skip link can reach', (_file, mains) => {
    expect(mains, 'a page with no <main> has nothing to skip to').not.toHaveLength(0);
    for (const tag of mains) {
      expect(tag).toContain('id="main"');
      // Without this the fragment scrolls but does not move focus, so the next Tab press carries on
      // from the link and walks straight back into the header it just skipped.
      expect(tag).toContain('tabIndex={-1}');
    }
  });
});
