import { describe, expect, it } from 'vitest';
import type { Expense } from '@owewell/core';
import { lensAmount, lensTotal, matchesPersonLens, shareOf, spendByCategory } from './activityFilters';

// Minimal expense fixtures. A pays e1 ($60, food) + e3 ($90, food); B pays e2 ($30, transport).
// e1/e3 are split A/B/C; e2 is split B/C only (A isn't in it).
function exp(payerId: string, amountCents: number, category: string, splits: [string, number][]): Expense {
  return {
    id: `${payerId}-${amountCents}`,
    description: 'x',
    amountCents,
    payerId,
    splitMethod: 'EQUAL',
    category,
    createdAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
    splits: splits.map(([userId, owedCents]) => ({ userId, owedCents })),
  } as Expense;
}

const e1 = exp('A', 6000, 'food', [
  ['A', 2000],
  ['B', 2000],
  ['C', 2000],
]);
const e2 = exp('B', 3000, 'transport', [
  ['B', 1500],
  ['C', 1500],
]);
const e3 = exp('A', 9000, 'food', [
  ['A', 3000],
  ['B', 3000],
  ['C', 3000],
]);
const all = [e1, e2, e3];

describe('shareOf', () => {
  it('returns the participant owed share, or 0 when not in the split', () => {
    expect(shareOf(e1, 'B')).toBe(2000);
    expect(shareOf(e2, 'A')).toBe(0);
  });
});

describe('matchesPersonLens', () => {
  it('matches everything when no person is selected', () => {
    expect(all.every((e) => matchesPersonLens(e, null, 'owes'))).toBe(true);
  });

  it('involved = paid it or owes a share of it', () => {
    expect(all.filter((e) => matchesPersonLens(e, 'A', 'involved'))).toEqual([e1, e3]); // A isn't in e2
    expect(all.filter((e) => matchesPersonLens(e, 'B', 'involved'))).toEqual([e1, e2, e3]);
  });

  it('owes = has a share but did not pay (the payer is owed, not owing)', () => {
    expect(all.filter((e) => matchesPersonLens(e, 'A', 'owes'))).toEqual([]); // A only appears on bills A paid
    expect(all.filter((e) => matchesPersonLens(e, 'B', 'owes'))).toEqual([e1, e3]); // e2 is B's own
  });

  it('paid = the person is the payer', () => {
    expect(all.filter((e) => matchesPersonLens(e, 'A', 'paid'))).toEqual([e1, e3]);
    expect(all.filter((e) => matchesPersonLens(e, 'B', 'paid'))).toEqual([e2]);
  });
});

describe('lensAmount', () => {
  it('uses the full bill for involved/paid and the person share for owes', () => {
    expect(lensAmount(e1, 'B', 'involved')).toBe(6000);
    expect(lensAmount(e1, 'B', 'paid')).toBe(6000);
    expect(lensAmount(e1, 'B', 'owes')).toBe(2000);
    expect(lensAmount(e1, null, 'owes')).toBe(6000); // no person → full
  });
});

describe('lensTotal', () => {
  it('sums the whole group when unlensed', () => {
    expect(lensTotal(all, null, 'involved')).toBe(18000);
  });

  it('sums full bills for paid and only the share for owes', () => {
    expect(lensTotal(all, 'A', 'paid')).toBe(15000); // e1 + e3
    expect(lensTotal(all, 'A', 'owes')).toBe(0); // A never owes (paid its own)
    expect(lensTotal(all, 'B', 'owes')).toBe(5000); // B's share of e1 + e3
    expect(lensTotal(all, 'B', 'paid')).toBe(3000); // e2
  });
});

describe('spendByCategory', () => {
  it('groups by category, biggest first, using full bills', () => {
    expect(spendByCategory(all, null, 'involved').map((c) => [c.meta.key, c.cents])).toEqual([
      ['food', 15000],
      ['transport', 3000],
    ]);
  });

  it('uses the person share under the owes lens', () => {
    expect(spendByCategory(all, 'B', 'owes').map((c) => [c.meta.key, c.cents])).toEqual([['food', 5000]]);
  });
});
