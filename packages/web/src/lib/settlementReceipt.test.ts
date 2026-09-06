import { describe, expect, it } from 'vitest';
import { buildSettlementReceipt, liveReceipt } from './settlementReceipt';

describe('buildSettlementReceipt', () => {
  it('explains who cleared and what the group still has left', () => {
    const receipt = buildSettlementReceipt(
      {
        id: 'pay-1',
        fromUserId: 'b',
        toUserId: 'a',
        amountCents: 1200,
        method: 'venmo',
        createdAt: '2026-08-11T12:00:00.000Z',
      },
      [
        { userId: 'a', displayName: 'Ari', netCents: 2000, paidCents: 3000, owedCents: 1000 },
        { userId: 'b', displayName: 'Bo', netCents: -1200, paidCents: 0, owedCents: 1200 },
      ],
      [
        { userId: 'a', displayName: 'Ari', netCents: 800, paidCents: 3000, owedCents: 1000 },
        { userId: 'b', displayName: 'Bo', netCents: 0, paidCents: 0, owedCents: 1200 },
      ],
      [{ fromUserId: 'c', fromName: 'Cam', toUserId: 'a', toName: 'Ari', amountCents: 800 }],
    );

    expect(receipt.clearedNames).toEqual(['Bo']);
    expect(receipt.remainingTransfers).toBe(1);
    expect(receipt.remainingCents).toBe(800);
    expect(receipt.changes.map((change) => change.afterCents)).toEqual([0, 800]);
  });

  it('reports a fully settled group', () => {
    const receipt = buildSettlementReceipt(
      {
        id: 'pay-2',
        fromUserId: 'b',
        toUserId: 'a',
        amountCents: 500,
        method: null,
        createdAt: '2026-08-11T12:00:00.000Z',
      },
      [
        { userId: 'a', displayName: 'Ari', netCents: 500, paidCents: 500, owedCents: 0 },
        { userId: 'b', displayName: 'Bo', netCents: -500, paidCents: 0, owedCents: 500 },
      ],
      [
        { userId: 'a', displayName: 'Ari', netCents: 0, paidCents: 500, owedCents: 0 },
        { userId: 'b', displayName: 'Bo', netCents: 0, paidCents: 0, owedCents: 500 },
      ],
      [],
    );

    expect(receipt.clearedNames).toEqual(['Bo', 'Ari']);
    expect(receipt.remainingTransfers).toBe(0);
    expect(receipt.remainingCents).toBe(0);
  });
});

describe('liveReceipt', () => {
  const settlement = {
    id: 'pay-1',
    fromUserId: 'b',
    toUserId: 'a',
    amountCents: 500,
    method: null,
    createdAt: '2026-08-11T12:00:00.000Z',
  };
  const receipt = buildSettlementReceipt(
    settlement,
    [
      { userId: 'a', displayName: 'Ari', netCents: 500, paidCents: 500, owedCents: 0 },
      { userId: 'b', displayName: 'Bo', netCents: -500, paidCents: 0, owedCents: 500 },
    ],
    [
      { userId: 'a', displayName: 'Ari', netCents: 0, paidCents: 500, owedCents: 0 },
      { userId: 'b', displayName: 'Bo', netCents: 0, paidCents: 0, owedCents: 500 },
    ],
    [],
  );

  it('keeps showing while the payment it explains is still on the ledger', () => {
    expect(liveReceipt(receipt, [settlement])).toBe(receipt);
  });

  it('goes when that payment is undone, so it cannot keep saying everyone is settled', () => {
    expect(receipt.remainingTransfers).toBe(0);
    expect(liveReceipt(receipt, [])).toBeNull();
  });

  it('is unmoved by other payments coming and going', () => {
    const other = { ...settlement, id: 'pay-2' };
    expect(liveReceipt(receipt, [other, settlement])).toBe(receipt);
    expect(liveReceipt(receipt, [other])).toBeNull();
  });

  it('has nothing to show when no payment was recorded', () => {
    expect(liveReceipt(null, [settlement])).toBeNull();
  });
});
