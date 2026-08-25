/**
 * WCAG contrast maths, plus the theme palettes as data.
 *
 * The palettes are duplicated from index.css so they can be tested. `contrast.test.ts` parses the
 * stylesheet and asserts the two copies agree, so they can't drift.
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
  /**
   * Fill for a destructive button. Don't use `neg` — it's a foreground, so in dark it's a light red
   * and white on it measures 2.77:1.
   *
   * Dark has to clear 3:1 against the page and 4.5:1 against white text at once, a luminance band
   * about 0.06 wide. Warm has no such squeeze and reuses `neg`.
   */
  negSolid: Hex;
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
  negSolid: '#c9342a',
};

/**
 * Direction B. Warm and light.
 *
 * `neg` needs a brightness gap from `pos`, not just a different hue: separated by hue alone they are
 * one colour to a red-green colourblind reader, in an app whose job is saying which way money goes.
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
  negSolid: '#8a2b1a',
};

export const THEMES = { dark: DARK, warm: WARM } as const;

/*
 * Categorical hues for the spend charts. One source for both themes, so bars and donut can't colour
 * the same data differently.
 *
 * A category keeps its hue across groups, and identity is never carried by colour alone: every
 * legend row pairs the swatch with a label.
 */
export type CategoryPalette = Record<
  'food' | 'groceries' | 'lodging' | 'transport' | 'entertainment' | 'shopping' | 'utilities' | 'other',
  Hex
>;

/** Tuned for the dark canvas. */
export const CATEGORY_DARK: CategoryPalette = {
  food: '#3987e5',
  groceries: '#199e70',
  lodging: '#c98500',
  transport: '#1f9a9e',
  entertainment: '#9085e9',
  shopping: '#e66767',
  utilities: '#d55181',
  other: '#d95926',
};

/** Darkened for the warm canvas, where the dark set washed out against #faf7f2 and #ffffff. */
export const CATEGORY_WARM: CategoryPalette = {
  food: '#1e5fa8',
  groceries: '#136b4d',
  lodging: '#8a5b00',
  transport: '#146b6e',
  entertainment: '#5b52a8',
  shopping: '#a83f3f',
  utilities: '#9c3459',
  other: '#9c3e1a',
};

/*
 * Avatar discs, per theme. Ten hues at one lightness; see `Avatar.tsx` for why, and for the dark ink.
 *
 * Only lightness and the chroma cap differ, so a person keeps their hue across themes. Warm caps
 * chroma at 0.10 so the discs don't outrank the money (0.132) and the accent (0.093) on a near-white
 * page. That costs separation — ten hues at one lightness separate mostly by chroma — so the closest
 * warm pair is 0.061 apart against dark's 0.097.
 */
export type AvatarPalette = readonly [Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex];

/** L 0.74, chroma as high as each hue can hold. Vivid, for a near-black page. */
export const AVATAR_DARK: AvatarPalette = [
  '#ff7d80',
  '#f98924',
  '#cda600',
  '#8bbe36',
  '#00c990',
  '#00c2ca',
  '#14b8ff',
  '#8ea4ff',
  '#c98afc',
  '#f37ac5',
];

/** L 0.80, chroma capped at 0.10, so the discs read as identity and not as the loudest thing. */
export const AVATAR_WARM: AvatarPalette = [
  '#f8a4a3',
  '#f0ad7e',
  '#d5bc70',
  '#abca84',
  '#7dd2ad',
  '#64d1d7',
  '#7bc8f6',
  '#a8baff',
  '#d0acf0',
  '#eca4ce',
];

/** Near-black rather than pure, so it belongs to the same world as the rest of the ink. */
export const AVATAR_INK: Hex = '#1b1a1f';

export const CATEGORY_THEMES = { dark: CATEGORY_DARK, warm: CATEGORY_WARM } as const;
export type ThemeName = keyof typeof THEMES;
