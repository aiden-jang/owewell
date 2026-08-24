import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The committed brand assets, against the palette they claim to be built from.
 *
 * This is the drift that actually happened. The accent moved from a violet-to-cyan gradient to a
 * green, `BrandMark` and `og.svg` were both updated, and `icon.svg` was not — so for weeks every
 * browser tab, home-screen icon and iOS share sheet showed the previous design language while the
 * app itself showed the current one. Nothing failed, because a favicon has no types and no tests.
 *
 * Read off the files rather than rendered: what ships is the committed bytes.
 */

const web = process.cwd();
const read = (p: string): string => readFileSync(resolve(web, p), 'utf8');

const theme = read('src/lib/theme.ts');
const contrast = read('src/lib/contrast.ts');

/** The palette static assets are built against, resolved the same way scripts/og.mjs resolves it. */
const shipped = /SHIPPED_THEME: ThemeName = '(\w+)'/.exec(theme)?.[1];
const paletteBlock = new RegExp(
  `export const ${shipped === 'warm' ? 'WARM' : 'DARK'}: Palette = \\{([^}]+)\\}`,
).exec(contrast)?.[1];
const palette = Object.fromEntries(
  [...(paletteBlock ?? '').matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2]!]),
);

describe('the committed brand assets', () => {
  it('resolves the palette they are built from', () => {
    expect(shipped, 'SHIPPED_THEME missing — scripts/og.mjs reads it too').toBeTruthy();
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(['public/icon.svg', 'public/og.svg'])('%s paints the current accent', (file) => {
    const svg = read(file);
    expect(svg.toLowerCase()).toContain(palette.accent!.toLowerCase());
  });

  /*
   * Named, not inferred. The old mark was these two stops, and a check that only asserts the new
   * colour is present would still pass on a file that had both — which is what a half-done swap
   * looks like.
   */
  it.each(['public/icon.svg', 'public/og.svg'])('%s keeps nothing from the retired gradient', (file) => {
    const svg = read(file).toLowerCase();
    for (const retired of ['#a78bfa', '#22d3ee']) expect(svg).not.toContain(retired);
  });
});
