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
   * The manifest's colours are unreachable from the palette: a splash screen is painted before any
   * CSS runs, so they have to be literals in a JSON file. That makes them the one place a palette
   * change cannot propagate to and nothing complains — the same shape as the favicon drift above.
   *
   * `background_color` is the splash and `theme_color` is the installed title bar. Neither can vary
   * by colour scheme; the manifest spec has no media queries, which is why the scheme-aware
   * `<meta name="theme-color">` pair in index.html exists alongside them and overrides the second
   * one at runtime. So the manifest is pinned to SHIPPED_THEME, the same palette the icons are
   * drawn against, and a dark-mode splash is a platform limit rather than a decision.
   */
  it('the manifest is painted in the palette the icons are', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, string>;
    expect(manifest.background_color?.toLowerCase()).toBe(palette.canvas!.toLowerCase());
    expect(manifest.theme_color?.toLowerCase()).toBe(palette.canvas!.toLowerCase());
  });

  // The light half of the pair must agree with the manifest, or the splash and the first painted
  // frame are different colours.
  it('and index.html agrees with it', () => {
    const html = read('index.html');
    const light =
      /<meta name="theme-color" content="(#[0-9a-fA-F]{6})" media="\(prefers-color-scheme: light\)"/.exec(
        html,
      )?.[1];
    const dark =
      /<meta name="theme-color" content="(#[0-9a-fA-F]{6})" media="\(prefers-color-scheme: dark\)"/.exec(
        html,
      )?.[1];
    expect(light?.toLowerCase(), 'light theme-color meta').toBe(palette.canvas!.toLowerCase());
    expect(dark?.toLowerCase(), 'dark theme-color meta').toBeTruthy();
    expect(dark?.toLowerCase()).not.toBe(light?.toLowerCase());
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
