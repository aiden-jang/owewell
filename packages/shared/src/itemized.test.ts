import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { computeItemizedSplit, computeItemizedPayers } from './itemized.js';
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

describe('computeItemizedPayers', () => {
  test('sums each payer’s items', () => {
    const paid = computeItemizedPayers({
      items: [
        { amountCents: 1000, payerId: 'a' },
        { amountCents: 2000, payerId: 'b' },
        { amountCents: 500, payerId: 'a' },
      ],
    });
    const byPayer = Object.fromEntries(paid.map((p) => [p.userId, p.paidCents]));
    expect(byPayer).toEqual({ a: 1500, b: 2000 });
  });

  test('spreads tax and tip across payers in proportion to what they paid', () => {
    const paid = computeItemizedPayers({
      items: [
        { amountCents: 1000, payerId: 'a' },
        { amountCents: 3000, payerId: 'b' },
      ],
      taxCents: 400,
    });
    const byPayer = Object.fromEntries(paid.map((p) => [p.userId, p.paidCents]));
    // 400 split 1000:3000 -> 100 / 300.
    expect(byPayer).toEqual({ a: 1100, b: 3300 });
  });

  test('property: payer totals always sum to items + tax + tip', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountCents: fc.nat(500_000),
            payerId: fc.integer({ min: 0, max: 6 }).map((n) => `u${n}`),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.nat(50_000),
        fc.nat(50_000),
        (items, taxCents, tipCents) => {
          const paid = computeItemizedPayers({ items, taxCents, tipCents });
          const itemsTotal = items.reduce((sum, item) => sum + item.amountCents, 0);
          const paidTotal = paid.reduce((sum, p) => sum + p.paidCents, 0);
          expect(paidTotal).toBe(itemsTotal + taxCents + tipCents);
        },
      ),
    );
  });
});

describe('odd-cent seeding', () => {
  // Three people on a $10.00 item is 333/333/334: somebody has to take the extra cent.
  const item = { amountCents: 1000, participantIds: ['a', 'b', 'c'] };

  test('unseeded, the first person on an item always absorbs the leftover', () => {
    const absorbers = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const shares = computeItemizedSplit({ items: [item] });
      absorbers.add(shares.find((s) => s.owedCents === 334)!.userId);
    }
    expect([...absorbers]).toEqual(['a']);
  });

  test('seeded, the leftover moves across the items of one receipt', () => {
    const shares = computeItemizedSplit({ items: Array.from({ length: 8 }, () => item), seed: 'exp_1' });
    // Eight identical items, so an unseeded run would hand all eight leftovers to 'a' and leave the
    // three people 8 cents apart. Seeding per item spreads them.
    const spread = Math.max(...shares.map((s) => s.owedCents)) - Math.min(...shares.map((s) => s.owedCents));
    expect(spread).toBeLessThanOrEqual(2);
  });

  test('still sums to the total, seeded or not', () => {
    for (const seed of [undefined, 'exp_1', 'exp_2']) {
      const shares = computeItemizedSplit({ items: [item, item, item], taxCents: 137, tipCents: 211, seed });
      expect(shares.reduce((sum, s) => sum + s.owedCents, 0)).toBe(3000 + 137 + 211);
    }
  });
});
