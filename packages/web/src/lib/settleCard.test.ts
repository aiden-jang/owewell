import { describe, expect, it } from 'vitest';
import type { SuggestedPayment } from './settlements';
import { settleCardRows } from './settleCard';

const payment = (index: number): SuggestedPayment => ({
  fromUserId: `from-${index}`,
  fromName: `Payer ${index}`,
  toUserId: `to-${index}`,
  toName: `Recipient ${index}`,
  amountCents: index * 100,
});

describe('settleCardRows', () => {
  it('keeps the card readable and reports hidden transfers', () => {
    const result = settleCardRows(Array.from({ length: 7 }, (_, index) => payment(index + 1)));
    expect(result.visible).toHaveLength(4);
    expect(result.hidden).toBe(3);
  });

  it('shows every transfer when the plan is short', () => {
    expect(settleCardRows([payment(1), payment(2)])).toEqual({
      visible: [payment(1), payment(2)],
      hidden: 0,
    });
  });
});
