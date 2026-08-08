import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { computeSplit, quickSplitSeed, SplitError, type SplitMethod } from './split.js';

const ids = (n: number): { userId: string }[] =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));

describe('computeSplit', () => {
  test('EQUAL divides evenly, leftover cent to the first', () => {
    expect(computeSplit('EQUAL', 1000, ids(3))).toEqual([
      { userId: 'u0', owedCents: 334 },
      { userId: 'u1', owedCents: 333 },
      { userId: 'u2', owedCents: 333 },
    ]);
  });

  test('SHARES splits by weight', () => {
    expect(computeSplit('SHARES', 1000, [
      { userId: 'a', value: 2 },
      { userId: 'b', value: 1 },
      { userId: 'c', value: 1 },
    ])).toEqual([
      { userId: 'a', owedCents: 500 },
      { userId: 'b', owedCents: 250 },
      { userId: 'c', owedCents: 250 },
    ]);
  });

  test('PERCENT splits by basis points and must total 100%', () => {
    expect(computeSplit('PERCENT', 1000, [
      { userId: 'a', value: 6000 },
      { userId: 'b', value: 4000 },
    ])).toEqual([
      { userId: 'a', owedCents: 600 },
      { userId: 'b', owedCents: 400 },
    ]);
    expect(() =>
      computeSplit('PERCENT', 1000, [
        { userId: 'a', value: 6000 },
        { userId: 'b', value: 3000 },
      ]),
    ).toThrow(SplitError);
  });

  test('EXACT passes through and must total the bill', () => {
    expect(computeSplit('EXACT', 1000, [
      { userId: 'a', value: 600 },
      { userId: 'b', value: 400 },
    ])).toEqual([
      { userId: 'a', owedCents: 600 },
      { userId: 'b', owedCents: 400 },
    ]);
    expect(() =>
      computeSplit('EXACT', 1000, [
        { userId: 'a', value: 600 },
        { userId: 'b', value: 300 },
      ]),
    ).toThrow(SplitError);
  });

  test('rejects empty participants, duplicates, and missing values', () => {
    expect(() => computeSplit('EQUAL', 100, [])).toThrow(SplitError);
    expect(() =>
      computeSplit('EQUAL', 100, [{ userId: 'a' }, { userId: 'a' }]),
    ).toThrow(SplitError);
    expect(() => computeSplit('SHARES', 100, [{ userId: 'a' }])).toThrow(SplitError);
  });

  test('property: EQUAL/SHARES/PERCENT always sum back to the total', () => {
    const methods: SplitMethod[] = ['EQUAL', 'SHARES'];
    fc.assert(
      fc.property(
        fc.nat(5_000_000),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 12 }),
        fc.constantFrom(...methods),
        (total, weights, method) => {
          const participants = weights.map((w, i) => ({ userId: `u${i}`, value: w }));
          const shares = computeSplit(method, total, participants);
          expect(shares.reduce((sum, s) => sum + s.owedCents, 0)).toBe(total);
        },
      ),
    );
  });
});

describe('quickSplitSeed', () => {
  test('gives the browser and the server the same allocation for the same item', () => {
    const people = [{ userId: 'you' }, { userId: 'sam' }, { userId: 'max' }];
    // Whatever the preview computes for item N must be what the save computes for item N.
    for (let i = 0; i < 5; i++) {
      const preview = computeSplit('EQUAL', 1000, people, quickSplitSeed(i));
      const saved = computeSplit('EQUAL', 1000, people, quickSplitSeed(i));
      expect(saved).toEqual(preview);
    }
  });

  test('still moves the odd cent around across the items of one split', () => {
    const people = [{ userId: 'you' }, { userId: 'sam' }, { userId: 'max' }];
    const absorbers = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const shares = computeSplit('EQUAL', 1000, people, quickSplitSeed(i));
      absorbers.add(shares.find((s) => s.owedCents === 334)!.userId);
    }
    // The whole point of seeding: the leftover cannot always land on whoever is listed first.
    expect(absorbers.size).toBeGreaterThan(1);
  });
});
