import type { ReactNode } from 'react';

/*
 * A person, as a coloured disc with their initial in it.
 *
 * ── The palette ──
 *
 * Ten hues, evenly spaced around the OKLCH wheel at one fixed lightness, generated rather than
 * picked by hand. Two things came out of doing it that way.
 *
 * Even spacing, because the old eight were chosen individually and had near-duplicates in them: two
 * reds and two pinks, closer to each other than any pair here. That never showed while avatars sat
 * one per row, and became the first thing you noticed once `MemberStrip` put five of them shoulder
 * to shoulder. Colour still comes from the name, so a collision is always possible — with ten
 * buckets and five people it is likelier than not — but a collision now reads as two people sharing
 * a colour rather than as a smudge.
 *
 * One lightness, because OKLCH's L is perceptual: at a fixed L no disc is heavier than its
 * neighbour, which is the thing that made the old row look uneven. Chroma is whatever each hue can
 * hold at that lightness, since sRGB simply cannot make a vivid yellow as dark as a vivid blue.
 *
 * ── The ink ──
 *
 * Dark, not white, and that is the whole reason the discs can be this bright. White on a friendly
 * mid-tone colour is the default everywhere and it does not pass: every one of the old eight sat
 * between 2.45:1 and 3.61:1 against white, well under the 4.5:1 this initial needs. Dragging them
 * dark enough for white text turned the yellows and greens to olive. Flipping the ink instead keeps
 * the colour bright and clears 4.5:1 with room to spare. Checked in `Avatar.test.ts`.
 */

const COLORS = [
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
] as const;

/** Near-black rather than pure, so it belongs to the same world as the rest of the ink. */
const INK = '#1b1a1f';

/*
 * FNV-1a plus murmur3's finalizer, replacing the `hash * 31 + c` this used to run.
 *
 * The mixing step is not optional here, and leaving it out is a mistake you can see. Picking a
 * colour is `hash % 10`, which reads the low bits, and neither `* 31` nor FNV alone avalanches
 * those well on strings as short as a first name: across fifty names the raw version piled thirteen
 * onto one colour, and a preview of twelve came out five blues, three greens and no warm colour at
 * all. The finalizer costs four instructions and flattens the worst bucket from thirteen to eight.
 */
function colorFor(name: string): string {
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** Exported so the spread can be measured; nothing else should care how a colour is chosen. */
export function avatarColor(name: string): string {
  return colorFor(name);
}

const DIMS = { xs: 'h-6 w-6 text-2xs', sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm' } as const;

export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof DIMS }): ReactNode {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${DIMS[size]}`}
      style={{ backgroundColor: colorFor(name), color: INK }}
    >
      {initial}
    </span>
  );
}

/** Exported for the contrast test, which is the only thing outside this file that needs them. */
export const AVATAR_COLORS = COLORS;
export const AVATAR_INK = INK;
