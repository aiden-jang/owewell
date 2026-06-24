import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { simplifyDebts, SettleError, type NetBalance, type Transfer } from './settle.js';

function applyTransfers(balances: NetBalance[], transfers: Transfer[]): Map<string, number> {
  const net = new Map(balances.map((b) => [b.userId, b.netCents]));
  for (const t of transfers) {
    net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) + t.amountCents);
    net.set(t.toUserId, (net.get(t.toUserId) ?? 0) - t.amountCents);
  }
  return net;
}

describe('simplifyDebts', () => {
  test('one debtor pays one creditor', () => {
    expect(
      simplifyDebts([
        { userId: 'a', netCents: 500 },
        { userId: 'b', netCents: -500 },
      ]),
    ).toEqual([{ fromUserId: 'b', toUserId: 'a', amountCents: 500 }]);
  });

  test('reciprocal rounds collapse to two clean transfers', () => {
    // Ann +20, Bob +20, Cara -20, Dan -20 -> two single payments, nobody pays two people.
    const transfers = simplifyDebts([
      { userId: 'ann', netCents: 2000 },
      { userId: 'bob', netCents: 2000 },
      { userId: 'cara', netCents: -2000 },
      { userId: 'dan', netCents: -2000 },
    ]);
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.amountCents === 2000)).toBe(true);
  });

  test('ignores already-settled members', () => {
    const transfers = simplifyDebts([
      { userId: 'a', netCents: 0 },
      { userId: 'b', netCents: 300 },
      { userId: 'c', netCents: -300 },
    ]);
    expect(transfers).toEqual([{ fromUserId: 'c', toUserId: 'b', amountCents: 300 }]);
  });

  test('throws when balances do not net to zero', () => {
    expect(() => simplifyDebts([{ userId: 'a', netCents: 100 }])).toThrow(SettleError);
  });

  test('property: transfers reconcile every balance to zero, with at most n-1 of them', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 1, maxLength: 15 }),
        (rawNets) => {
          // Force the set to sum to zero by absorbing the remainder into one extra member.
          const sum = rawNets.reduce((s, n) => s + n, 0);
          const balances: NetBalance[] = rawNets.map((n, i) => ({ userId: `u${i}`, netCents: n }));
          balances.push({ userId: 'sink', netCents: -sum });

          const transfers = simplifyDebts(balances);
          const settled = applyTransfers(balances, transfers);
          for (const value of settled.values()) {
            expect(value).toBe(0);
          }
          expect(transfers.every((t) => t.amountCents > 0)).toBe(true);
          const nonZero = balances.filter((b) => b.netCents !== 0).length;
          expect(transfers.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
        },
      ),
    );
  });
});
