/**
 * WCAG relative-contrast maths, plus the theme palettes as data.
 *
 * The palettes live here as well as in index.css because a colour that fails contrast is a real defect
 * and defects deserve tests. This duplication is deliberate and checked: `contrast.test.ts` parses
 * index.css and asserts the two copies agree, so they cannot drift.
 */

export type Hex = `#${string}`;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: Hex): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) throw new Error(`Expected a 6-digit hex colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

/** 1 (identical) to 21 (black on white). AA wants 4.5 for body text, 3 for large text and UI edges. */
export function contrast(a: Hex, b: Hex): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Palette {
  canvas: Hex;
  card: Hex;
  surface2: Hex;
  ink: Hex;
  muted: Hex;
  faint: Hex;
  line: Hex;
  lineStrong: Hex;
  accent: Hex;
  accentHover: Hex;
  accentSoft: Hex;
  accentInk: Hex;
  field: Hex;
  pos: Hex;
  neg: Hex;
}

/** Direction A. Neutral, flat, no purple cast. */
export const DARK: Palette = {
  canvas: '#0b0b0d',
  card: '#121215',
  surface2: '#191920',
  ink: '#ededf0',
  muted: '#9c9ca6',
  faint: '#74747e',
  line: '#1f1f24',
  lineStrong: '#2c2c33',
  accent: '#4f46e5',
  accentHover: '#635bf0',
  accentSoft: '#16161f',
  accentInk: '#ffffff',
  field: '#101013',
  pos: '#4ade80',
  neg: '#f87171',
};

/**
 * Direction B. Warm and light.
 *
 * `muted`, `faint` and `neg` are darker than the original mock. At #8a7f72, #8a7f72 and #b4442f they
 * failed AA against the warm canvas, and a light theme hides that far better than a dark one does.
 *
 * `neg` moved twice. #a83c28 passed AA but sat within 0.5% luminance of `pos`, so the two money states
 * were separated by hue alone — invisible to a red-green colourblind reader, in an app whose entire job
 * is telling you which way the money goes. #8a2b1a keeps the clay and adds a brightness gap.
 */
export const WARM: Palette = {
  canvas: '#faf7f2',
  card: '#ffffff',
  surface2: '#f2ede4',
  ink: '#26221d',
  muted: '#6d645a',
  faint: '#857b70',
  line: '#ece5da',
  lineStrong: '#ddd3c5',
  accent: '#1f6f4f',
  accentHover: '#1a5f43',
  accentSoft: '#eaf3ee',
  accentInk: '#ffffff',
  field: '#ffffff',
  pos: '#1f6f4f',
  neg: '#8a2b1a',
};

export const THEMES = { dark: DARK, warm: WARM } as const;
export type ThemeName = keyof typeof THEMES;
