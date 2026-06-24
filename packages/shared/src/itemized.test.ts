import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { computeItemizedSplit } from './itemized.js';
import { SplitError } from './split.js';

describe('computeItemizedSplit', () => {
  test('splits items among their people', () => {
    const shares = computeItemizedSplit({
      items: [
        { amountCents: 1000, participantIds: ['a', 'b'] },
        { amountCents: 2000, participantIds: ['b', 'c'] },
      ],
    });
    const owed = Object.fromEntries(shares.map((s) => [s.userId, s.owedCents]));
    expect(owed).toEqual({ a: 500, b: 1500, c: 1000 });
  });

  test('spreads tax and tip in proportion to what each person ordered', () => {
    const shares = computeItemizedSplit({
      items: [
        { amountCents: 1000, participantIds: ['a'] },
        { amountCents: 3000, participantIds: ['b'] },
      ],
      taxCents: 400,
    });
    const owed = Object.fromEntries(shares.map((s) => [s.userId, s.owedCents]));
    // 400 tax split 1000:3000 -> 100 / 300.
    expect(owed).toEqual({ a: 1100, b: 3300 });
  });

  test('rejects empty items or an item with nobody on it', () => {
    expect(() => computeItemizedSplit({ items: [] })).toThrow(SplitError);
    expect(() => computeItemizedSplit({ items: [{ amountCents: 100, participantIds: [] }] })).toThrow(
      SplitError,
    );
  });

  test('property: shares always sum to items + tax + tip', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountCents: fc.nat(500_000),
            participantIds: fc
              .uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 })
              .map((ids) => ids.map((n) => `u${n}`)),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.nat(50_000),
        fc.nat(50_000),
        (items, taxCents, tipCents) => {
          const shares = computeItemizedSplit({ items, taxCents, tipCents });
          const itemsTotal = items.reduce((sum, item) => sum + item.amountCents, 0);
          const owedTotal = shares.reduce((sum, s) => sum + s.owedCents, 0);
          expect(owedTotal).toBe(itemsTotal + taxCents + tipCents);
        },
      ),
    );
  });
});
