import { describe, expect, it } from 'vitest';
import { contrast, type Hex } from '../lib/contrast';
import { avatarColor, AVATAR_COLORS, AVATAR_INK } from './Avatar';

/**
 * The two properties the avatar palette exists to have.
 *
 * Both were broken before, and neither is visible in a diff: a hex is just a hex, and you only find
 * out it was the wrong one by looking at the app on the day somebody complains. So they are measured.
 */

/** Perceptual distance in Oklab, which is where "these two look the same" is a number. */
function oklab(hex: Hex): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16))) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function distance(a: Hex, b: Hex): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe('the avatar palette', () => {
  /*
   * The initial is 11px semibold at its smallest, which is body text by WCAG's reckoning, so 4.5:1.
   *
   * The palette this replaced ran 2.45:1 to 3.61:1 against the white it was printed in — every
   * colour failing, the amber and the cyan badly. That is what forced the dark ink: a disc bright
   * enough to be friendly cannot carry white text at AA.
   */
  it('prints readable ink on every colour', () => {
    for (const color of AVATAR_COLORS) {
      expect(contrast(color, AVATAR_INK as Hex), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
   * The floor is set just under the closest pair the generated set actually contains, so it fails on
   * a hand-added colour rather than tracking whatever happens to be there. For reference the old
   * palette's two nearest (#f0573f and #cf6b3a, both red) sat at 0.068 and read as one colour twice
   * once MemberStrip put them side by side.
   */
  it('keeps every pair far enough apart to read as different people', () => {
    for (let i = 0; i < AVATAR_COLORS.length; i++) {
      for (let j = i + 1; j < AVATAR_COLORS.length; j++) {
        const [a, b] = [AVATAR_COLORS[i]!, AVATAR_COLORS[j]!];
        expect(distance(a, b), `${a} vs ${b}`).toBeGreaterThan(0.085);
      }
    }
  });

  // Equal perceptual lightness is what stops one disc in a row looking heavier than the rest.
  it('holds one lightness across the whole wheel', () => {
    const lightness = AVATAR_COLORS.map((c) => oklab(c)[0]);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.02);
  });
});

/*
 * That a name maps to a colour is not the interesting property; that fifty of them do not pile onto
 * the same one is. `hash % 10` reads the low bits, and the FNV-1a this runs does not avalanche them
 * on its own, so without the murmur finalizer the worst bucket here holds thirteen and a group of
 * five comes out all one colour family.
 */
describe('picking a colour for a name', () => {
  const NAMES = [
    'Alice', 'Bo', 'Cara', 'Dev', 'Elle', 'Finn', 'Gus', 'Hana', 'Ines', 'Jo',
    'Kit', 'Lou', 'Maya', 'Noah', 'Omar', 'Priya', 'Quinn', 'Ruth', 'Sam', 'Tess',
    'Uma', 'Vik', 'Wren', 'Xu', 'Yara', 'Zane', 'Ben', 'Chloe', 'Dan', 'Emma',
    'Felix', 'Grace', 'Hugo', 'Iris', 'Jack', 'Kara', 'Liam', 'Mia', 'Nate', 'Olive',
    'Pete', 'Rosa', 'Seb', 'Tom', 'Ana', 'Bea', 'Cy', 'Dot', 'Eli', 'Fay',
  ];

  it('spreads fifty names across the whole wheel', () => {
    const counts = new Map<string, number>();
    for (const name of NAMES) counts.set(avatarColor(name), (counts.get(avatarColor(name)) ?? 0) + 1);
    expect(counts.size).toBe(AVATAR_COLORS.length);
    // Perfectly even would be five each. Ten is the point where one colour owns a fifth of everybody.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(10);
  });

  it('gives the same person the same colour every time', () => {
    expect(avatarColor('Priya')).toBe(avatarColor('Priya'));
  });

  // Housemates with matching initials were the case the old `hash * 31` got wrong.
  it('separates names that share a prefix', () => {
    expect(new Set(['Sam', 'Samir', 'Sammy', 'Samantha'].map(avatarColor)).size).toBeGreaterThan(1);
  });
});
