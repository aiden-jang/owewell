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
  /** Destructive fills must contrast with both the surface and white labels; neg is a foreground token. */
  negSolid: Hex;
}

/** Deep teal surfaces. */
export const DARK: Palette = {
  canvas: '#151d1e',
  card: '#1d2829',
  surface2: '#222e2f',
  ink: '#f3f0e7',
  muted: '#a5b7b6',
  faint: '#98aeac',
  line: '#354647',
  lineStrong: '#607977',
  accent: '#98cec9',
  accentHover: '#b0ddd7',
  accentSoft: '#243f40',
  accentInk: '#142d2f',
  field: '#1d2829',
  pos: '#4ade80',
  neg: '#f87171',
  negSolid: '#d34238',
};

/**
 * Direction B. Warm and light.
 *
 * `neg` needs a brightness gap from `pos`, not just a different hue: separated by hue alone they are
 * one colour to a red-green colourblind reader, in an app whose job is saying which way money goes.
 */
export const WARM: Palette = {
  canvas: '#f7f4ec',
  card: '#fffdf7',
  surface2: '#eeeade',
  ink: '#243636',
  muted: '#5d6d69',
  faint: '#5d6d67',
  line: '#dedfd4',
  lineStrong: '#bbc8bf',
  accent: '#215c60',
  accentHover: '#194b50',
  accentSoft: '#e3eeeb',
  accentInk: '#ffffff',
  field: '#fffdf7',
  pos: '#1f6f4f',
  neg: '#8a2b1a',
  negSolid: '#8a2b1a',
};

export const THEMES = { dark: DARK, warm: WARM } as const;

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
  entertainment: '#6dabc3',
  shopping: '#e66767',
  utilities: '#d55181',
  other: '#d95926',
};

/** Darkened for the warm canvas, where the dark set washed out against #f7f4ec and #ffffff. */
export const CATEGORY_WARM: CategoryPalette = {
  food: '#1e5fa8',
  groceries: '#136b4d',
  lodging: '#8a5b00',
  transport: '#146b6e',
  entertainment: '#356781',
  shopping: '#a83f3f',
  utilities: '#9c3459',
  other: '#9c3e1a',
};

// Keep each person's hue across themes; adjust lightness/chroma to suit the surface.
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
  '#aeaba0',
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
  '#c1bdb3',
  '#eca4ce',
];

/** Near-black rather than pure, so it belongs to the same world as the rest of the ink. */
export const AVATAR_INK: Hex = '#1b1a1f';

export const CATEGORY_THEMES = { dark: CATEGORY_DARK, warm: CATEGORY_WARM } as const;
export type ThemeName = keyof typeof THEMES;
