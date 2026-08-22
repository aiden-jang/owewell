import { describe, expect, it } from 'vitest';
import type { Expense } from '@owewell/core';
import { buildGroupRecap } from './groupRecap';

const expense = (id: string, description: string, amountCents: number, category: Expense['category'], date: string): Expense => ({
  id,
  description,
  amountCents,
  category,
  date,
  createdAt: date,
  payerId: 'a',
  splitMethod: 'EQUAL',
  splits: [], note: null,
});

describe('buildGroupRecap', () => {
  it('finds the biggest moment and category from a settled tab', () => {
    const recap = buildGroupRecap([
      expense('1', 'Cabin', 30000, 'lodging', '2026-08-01T12:00:00Z'),
      expense('2', 'Dinner', 9000, 'food', '2026-08-03T12:00:00Z'),
      expense('3', 'Breakfast', 3000, 'food', '2026-08-04T12:00:00Z'),
    ], []);
    expect(recap).toMatchObject({
      totalCents: 42000,
      largest: { description: 'Cabin', amountCents: 30000 },
      topCategory: { label: 'Lodging', amountCents: 30000 },
      daysOpen: 3,
    });
  });

  it('returns a quiet empty recap for a new group', () => {
    expect(buildGroupRecap([], [])).toEqual({
      totalCents: 0,
      largest: null,
      topCategory: null,
      daysOpen: 0,
    });
  });
});
