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
