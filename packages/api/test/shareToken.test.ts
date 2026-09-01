import { describe, expect, it } from 'vitest';
import { mintShareToken, looksLikeShareToken } from '../src/shareToken.js';

describe('share tokens', () => {
  it('has no character that can be misread as another', () => {
    const token = Array.from({ length: 400 }, mintShareToken).join('');
    expect(token).not.toMatch(/[ILOU]/);
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('is short enough to paste into a message', () => {
    expect(mintShareToken()).toHaveLength(14);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 5_000 }, mintShareToken));
    expect(seen.size).toBe(5_000);
  });

  it('spreads evenly over the alphabet, so the randomness is not biased', () => {
    // 32 divides 256, so masking a byte is unbiased. Using `% 32` on a non-power-of-two
    // alphabet is the classic way to skew this without noticing.
    const chars = Array.from({ length: 4_000 }, mintShareToken).join('');
    const counts = new Map<string, number>();
    for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(32);
    const expected = chars.length / 32;
    for (const [c, n] of counts) {
      expect(Math.abs(n - expected) / expected, `'${c}' appeared ${n} times`).toBeLessThan(0.2);
    }
  });

  it('still accepts the long hex tokens already out in the world', () => {
    const legacy = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    expect(looksLikeShareToken(legacy)).toBe(true);
    expect(looksLikeShareToken(mintShareToken())).toBe(true);
  });

  it('rejects anything that was never a real token', () => {
    for (const junk of ['', 'short', 'k7qm4x2wnp9rtv', 'K7QM4X2WNP9RT!', 'I'.repeat(14), 'x'.repeat(200)]) {
      expect(looksLikeShareToken(junk), junk).toBe(false);
    }
  });
});
