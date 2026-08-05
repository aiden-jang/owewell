import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { Money, MoneyError, allocateCents, dollarsToCents } from './money.js';

describe('dollarsToCents', () => {
  test('parses well-formed strings exactly', () => {
    expect(dollarsToCents('19.99')).toBe(1999);
    expect(dollarsToCents('0.05')).toBe(5);
    expect(dollarsToCents('100')).toBe(10000);
    expect(dollarsToCents('1.5')).toBe(150);
    expect(dollarsToCents('-3.50')).toBe(-350);
  });

  test('rounds numeric input without float drift', () => {
    // 19.99 * 100 is famously 1998.9999999999998 in floating point.
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  test('rejects malformed strings', () => {
    expect(() => dollarsToCents('12.345')).toThrow(MoneyError);
    expect(() => dollarsToCents('abc')).toThrow(MoneyError);
    expect(() => dollarsToCents('')).toThrow(MoneyError);
  });
});

describe('Money', () => {
  test('arithmetic stays in integer cents', () => {
    const a = Money.fromDollars('10.00');
    const b = Money.fromDollars('2.50');
    expect(a.add(b).cents).toBe(1250);
    expect(a.subtract(b).cents).toBe(750);
    expect(a.multiply(0.0825).cents).toBe(83); // 1000 * 0.0825 = 82.5 -> 83
  });

  test('formats and serializes', () => {
    const m = Money.fromCents(1999);
    expect(m.format()).toBe('$19.99');
    expect(JSON.stringify({ amount: m })).toBe('{"amount":1999}');
  });

  test('comparisons', () => {
    expect(Money.fromCents(100).equals(Money.fromCents(100))).toBe(true);
    expect(Money.fromCents(100).compareTo(Money.fromCents(200))).toBe(-1);
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.fromCents(-1).isNegative()).toBe(true);
  });

  test('rejects non-integer cents', () => {
    expect(() => Money.fromCents(1.5)).toThrow(MoneyError);
  });
});

describe('allocateCents (largest-remainder split)', () => {
  test('equal split hands the leftover cent to the first share', () => {
    expect(allocateCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  test('percentage split', () => {
    expect(allocateCents(1000, [60, 40])).toEqual([600, 400]);
    expect(allocateCents(1001, [50, 50])).toEqual([501, 500]);
  });

  test('weighted shares', () => {
    expect(allocateCents(1000, [2, 1, 1])).toEqual([500, 250, 250]);
  });

  test('rejects bad input', () => {
    expect(() => allocateCents(100, [])).toThrow(MoneyError);
    expect(() => allocateCents(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocateCents(-1, [1])).toThrow(MoneyError);
    expect(() => allocateCents(100, [-1, 2])).toThrow(MoneyError);
  });

  test('property: a split always sums back to the total, no penny lost or invented', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000_000),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocateCents(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((sum, c) => sum + c, 0)).toBe(total);
          expect(parts.every((c) => c >= 0)).toBe(true);
        },
      ),
    );
  });
});

describe('allocateCents rotation', () => {
  // Real symptom this fixes: two members on the same five expenses ended up 2 cents apart, because
  // an equal split gives every entry an identical fractional share, so the tie-break alone decides
  // who absorbs the leftover — and by plain index that is always whoever is listed first.
  const equalWeights = [1, 1, 1];

  function winners(total: number, weights: number[], seeds: readonly string[]): number[] {
    // Which index received an extra cent, for each seed.
    return seeds.map((seed) => {
      const base = Math.floor(total / weights.length);
      return allocateCents(total, weights, seed).findIndex((c) => c > base);
    });
  }

  test('still sums exactly to the total, seeded or not', () => {
    for (const seed of [undefined, 'a', 'b', 'expense-42', '']) {
      for (const total of [1, 2, 100, 1649, 3850, 999999]) {
        const parts = allocateCents(total, equalWeights, seed);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every((c) => Number.isInteger(c) && c >= 0)).toBe(true);
      }
    }
  });

  test('is deterministic: the same seed always gives the same answer', () => {
    // An expense must never reshuffle who owes the odd cent just because it was recomputed.
    const once = allocateCents(1000, equalWeights, 'expense-abc');
    for (let i = 0; i < 20; i++) {
      expect(allocateCents(1000, equalWeights, 'expense-abc')).toEqual(once);
    }
  });

  test('without a seed, keeps the old index-order behaviour', () => {
    // Callers that do not pass a seed are unchanged, so nothing recomputes differently by accident.
    expect(allocateCents(100, equalWeights)).toEqual([34, 33, 33]);
  });

  test('moves the odd cent around as the seed changes', () => {
    const seeds = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12'];
    const got = winners(100, equalWeights, seeds);
    // The point of the change: index 0 must not win every time.
    expect(new Set(got).size).toBeGreaterThan(1);
    // And every participant must be reachable, or the bias has only moved rather than gone.
    expect(new Set(got)).toEqual(new Set([0, 1, 2]));
  });

  test('spreads the leftover cent evenly over many expenses', () => {
    // The end state the user actually noticed: totals should not drift apart with volume.
    const seeds = Array.from({ length: 300 }, (_, i) => `expense-${i}`);
    const totals = [0, 0, 0];
    for (const seed of seeds) {
      allocateCents(100, equalWeights, seed).forEach((c, i) => {
        totals[i] = (totals[i] ?? 0) + c;
      });
    }
    const spread = Math.max(...totals) - Math.min(...totals);
    // Unseeded, index 0 would be exactly 300 cents ahead of the others.
    expect(spread).toBeLessThan(40);
  });

  test('leaves weighted splits alone: the largest fraction still wins', () => {
    // Rotation only breaks TIES. It must never override a genuinely larger fractional share.
    for (const seed of ['x', 'y', 'z', 'q', 'w']) {
      // 10 cents on weights 1:1:8 -> ideals 1.25, 1.25, 8.0; the odd cent belongs to a 0.25, not the 8.
      const parts = allocateCents(10, [1, 1, 8], seed);
      expect(parts[2]).toBe(8);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    }
  });
});
