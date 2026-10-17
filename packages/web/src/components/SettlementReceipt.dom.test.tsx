import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SettlementReceipt } from './SettlementReceipt';
import type { SettlementReceiptData } from '../lib/settlementReceipt';
const receipt: SettlementReceiptData = {
  settlement: {
    id: 'pay',
    fromUserId: 'a',
    toUserId: 'b',
    amountCents: 1200,
    method: 'cash',
    createdAt: '2026-10-14T12:00:00Z',
  },
  fromName: 'Ari',
  toName: 'Bo',
  changes: [],
  clearedNames: ['Ari', 'Bo'],
  remainingTransfers: 0,
  remainingCents: 0,
};
test('a receipt exposes the recorded instant and lets its existing undo flow finish once', async () => {
  let finish!: () => void;
  const undo = vi.fn().mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render(<SettlementReceipt receipt={receipt} onClose={() => {}} onUndo={undo} />);
  expect(screen.getByText(/2026/).getAttribute('datetime')).toBe(receipt.settlement.createdAt);
  fireEvent.click(screen.getByRole('button', { name: 'Undo this payment' }));
  const button = screen.getByRole('button', { name: 'Undoing…' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(undo).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Undo this payment' })).toBeEnabled();
});
