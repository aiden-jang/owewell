import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  AVATAR_DARK,
  AVATAR_INK,
  AVATAR_WARM,
  CATEGORY_DARK,
  CATEGORY_THEMES,
  CATEGORY_WARM,
  DARK,
  THEMES,
  WARM,
  contrast,
  luminance,
  type Hex,
  type Palette,
} from './contrast.js';

/**
 * Colour contrast, enforced rather than eyeballed.
 *
 * Four of the warm palette's original colours failed WCAG AA and the mock looked completely fine —
 * which is the whole problem with judging a light theme by eye. Secondary text at 3.6:1 reads as
 * "tasteful grey" to whoever picked it and as illegible to plenty of other people.
 */

const AA_TEXT = 4.5; // body text
const AA_LARGE = 3.0; // 18.66px+ bold or 24px+, and UI boundaries

/** Every surface a given text colour actually sits on in this app. */
const SURFACES = ['canvas', 'card', 'surface2'] as const satisfies readonly (keyof Palette)[];

describe.each(Object.entries(THEMES))('%s theme', (_name, p) => {
  test.each(['ink', 'muted'] as const)('%s is readable on every surface', (role) => {
    for (const surface of SURFACES) {
      const ratio = contrast(p[role], p[surface]);
      expect(ratio, `${role} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  /*
   * The one token used as a background rather than a foreground.
   *
   * `neg` cannot do this job: it is tuned to read as text on the page, so in the dark theme it is a
   * light red and white on it measures 2.77:1. That is why three danger buttons were hardcoded to
   * Tailwind's rose instead of using the palette at all.
   */
  test('a destructive button can carry white text', () => {
    const ratio = contrast('#ffffff', p.negSolid);
    expect(ratio, `white on negSolid is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // And it has to be visible as a shape, not just legible inside: a button whose fill matches the
  // page is a label. 3:1 is the bar for a UI component boundary.
  test('a destructive button is distinguishable from the page', () => {
    for (const surface of SURFACES) {
      expect(contrast(p.negSolid, p[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  test('faint text clears the large-text bar at least', () => {
    // `faint` is used for timestamps and secondary counts. Held to the large-text bar rather than
    // body, and named here so nobody assumes it is safe for a paragraph.
    for (const surface of SURFACES) {
      expect(contrast(p.faint, p[surface])).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  test.each(['pos', 'neg'] as const)('%s money colour is readable on every surface', (role) => {
    // These carry meaning, not decoration: if "you owe" is hard to read the app has failed at its job.
    for (const surface of SURFACES) {
      const ratio = contrast(p[role], p[surface]);
      expect(ratio, `${role} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  test('the primary button text is readable on the accent, hovered or not', () => {
    expect(contrast(p.accentInk, p.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(p.accentInk, p.accentHover)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('hairlines are visible against the surfaces they divide', () => {
    // Not a text rule, but a 1.02:1 divider is an invisible divider, and this theme leans on them
    // instead of nested cards.
    expect(contrast(p.line, p.card)).toBeGreaterThan(1.06);
    expect(contrast(p.lineStrong, p.card)).toBeGreaterThan(1.12);
  });

  test('surfaces are distinguishable from the canvas but not stripes', () => {
    const ratio = contrast(p.card, p.canvas);
    expect(ratio).toBeGreaterThan(1.03);
    expect(ratio).toBeLessThan(2.2);
  });

  test('pos and neg are told apart by more than hue', () => {
    // Roughly 8% of men cannot reliably separate red from green. A brightness gap means the sign is
    // still legible when the hue is not, on top of the +/- prefix in the copy.
    const gap = Math.abs(luminance(p.pos) - luminance(p.neg));
    expect(gap, `pos and neg differ by only ${(gap * 100).toFixed(1)}% luminance`).toBeGreaterThan(0.04);
  });
});

/*
 * The chart hues, which nobody was checking.
 *
 * They lived as literals inside SpendDonut and were picked against the dark canvas, so the warm
 * theme inherited colours chosen for a background it does not have. A swatch or a bar is a UI
 * boundary rather than text, so the bar is AA_LARGE — but it is a bar, not a decoration: if you
 * cannot tell it from the surface behind it, the chart is not saying anything.
 */
describe.each(Object.entries(CATEGORY_THEMES))('%s category hues', (name, cats) => {
  const surface = name === 'dark' ? DARK : WARM;

  test.each(Object.keys(cats) as (keyof typeof cats)[])('%s separates from every surface', (key) => {
    for (const on of SURFACES) {
      const ratio = contrast(cats[key], surface[on]);
      expect(ratio, `${key} on ${on} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  /*
   * Not tested: whether two categories "look alike".
   *
   * Three numeric rules were tried — luminance ratio, luminance gap, hue distance — and each flagged
   * a different innocent pair while missing the one that actually failed. Groceries and Transport
   * read as a single wedge in the ring at 10% and 4%, and they were 43° of hue apart, so no
   * threshold here would have caught them. Small arcs of similar-feeling colour is a judgement about
   * apparent size and saturation, and fitting a constant until the current palette passes would
   * measure nothing.
   *
   * So it is checked by looking. Transport moved from green to teal because groceries owns green.
   */

});

describe('the palettes match the stylesheet', () => {
  // contrast.ts duplicates what index.css declares. Tests cannot read CSS variables without a browser,
  // so the duplication buys testability — and this asserts the two copies cannot drift apart.
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

  function block(selector: string): Record<string, string> {
    const start = css.indexOf(selector);
    expect(start, `${selector} not found in index.css`).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    return Object.fromEntries(
      [...body.matchAll(/--p-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
    );
  }

  const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  test.each([
    ['dark', DARK, "[data-theme='dark']"],
    ['warm', WARM, "[data-theme='warm']"],
  ] as const)('%s', (_name, palette, selector) => {
    const declared = block(selector);
    for (const [role, hex] of Object.entries(palette)) {
      expect(declared[kebab(role)], `--p-${kebab(role)}`).toBe((hex as Hex).toLowerCase());
    }
  });

  test.each([
    ['dark', CATEGORY_DARK, "[data-theme='dark']"],
    ['warm', CATEGORY_WARM, "[data-theme='warm']"],
  ] as const)('%s category hues', (_name, cats, selector) => {
    const declared = block(selector);
    for (const [key, hex] of Object.entries(cats)) {
      expect(declared[`cat-${key}`], `--p-cat-${key}`).toBe((hex as Hex).toLowerCase());
    }
  });

  // Avatar.tsx reads these as var(--p-av-N) and never sees a hex, so a typo here would be invisible
  // everywhere except on the page itself.
  test.each([
    ['dark', AVATAR_DARK, "[data-theme='dark']"],
    ['warm', AVATAR_WARM, "[data-theme='warm']"],
  ] as const)('%s avatar hues', (_name, avatars, selector) => {
    const declared = block(selector);
    avatars.forEach((hex, i) => {
      expect(declared[`av-${i}`], `--p-av-${i}`).toBe(hex.toLowerCase());
    });
    expect(declared['av-ink'], '--p-av-ink').toBe(AVATAR_INK.toLowerCase());
  });
});
