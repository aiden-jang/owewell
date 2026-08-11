import { describe, expect, test } from 'vitest';
import type { Balance } from '@owewell/core';
import { frontingInsight } from './frontingInsight';

const balance = (userId: string, displayName: string, paidCents: number, owedCents = 5000): Balance => ({
  userId,
  displayName,
  paidCents,
  owedCents,
  netCents: paidCents - owedCents,
});

describe('frontingInsight', () => {
  test('spots a repeated fronter and suggests the least-used payer', () => {
    const insight = frontingInsight([
      balance('a', 'Alex', 8000),
      balance('b', 'Blair', 2000),
      balance('c', 'Casey', 0),
    ], 5);

    expect(insight?.leader).toMatchObject({ displayName: 'Alex', percent: 80 });
    expect(insight?.concentrated).toBe(true);
    expect(insight?.nextPayer?.displayName).toBe('Casey');
  });

  test('does not coach the group from one or two expenses', () => {
    const insight = frontingInsight([balance('a', 'Alex', 9000), balance('b', 'Blair', 1000)], 2);
    expect(insight?.concentrated).toBe(false);
    expect(insight?.nextPayer).toBeNull();
  });

  test('recognizes an evenly shared tab', () => {
    const insight = frontingInsight([
      balance('a', 'Alex', 5000),
      balance('b', 'Blair', 5000),
    ], 6);
    expect(insight?.concentrated).toBe(false);
    expect(insight?.shares.map((share) => share.percent)).toEqual([50, 50]);
  });

  test('returns nothing until at least two people are involved', () => {
    expect(frontingInsight([balance('a', 'Alex', 5000, 5000)], 4)).toBeNull();
    expect(frontingInsight([balance('a', 'Alex', 0, 0), balance('b', 'Blair', 0, 0)], 4)).toBeNull();
  });
});
