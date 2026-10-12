import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Balance, GroupMember } from '../lib/groups';
import { RecordPaymentForm } from './RecordPaymentForm';

/**
 * The amount somebody actually paid.
 *
 * This form is entirely about one number, and that number was styled as one more select sharing a
 * row with the method dropdown — the exact arrangement AddExpenseForm's own comment describes
 * moving away from. It was also the only money input in the app that did not tidy itself on blur,
 * so "8.5" stayed "8.5" here and became "8.50" in all eight other places you can type money.
 */

const member = (userId: string, displayName: string): GroupMember => ({
  userId,
  displayName,
  email: null,
  role: 'MEMBER',
  joinedAt: '2026-08-01T00:00:00.000Z',
  isPlaceholder: false,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
});

const MEMBERS = [member('a', 'Alice'), member('b', 'Bob')];
const BALANCES: Balance[] = [
  { userId: 'a', displayName: 'Alice', netCents: 4_000, paidCents: 8_000, owedCents: 4_000 },
  { userId: 'b', displayName: 'Bob', netCents: -4_000, paidCents: 0, owedCents: 4_000 },
];

function open() {
  render(
    <RecordPaymentForm
      groupId="g1"
      members={MEMBERS}
      defaultFromId="b"
      balances={BALANCES}
      onRecorded={vi.fn()}
    />,
  );
  return userEvent.setup();
}

describe('the amount field', () => {
  it('summarizes the people, amount and selected method before recording', async () => {
    const user = open();
    await user.type(screen.getByLabelText('Amount'), '20');
    await user.selectOptions(screen.getByLabelText('Payment method'), 'zelle');
    expect(screen.getByText('Bob paid Alice', { exact: false })).toHaveTextContent(
      'Bob paid Alice $20.00 via Zelle.',
    );
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
  });

  it('tidies a half-typed amount on blur, like every other money input', async () => {
    const user = open();
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '8.5');
    await user.tab();
    expect(amount).toHaveValue('8.50');
  });

  it('leaves a complete amount alone', async () => {
    const user = open();
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '12.34');
    await user.tab();
    expect(amount).toHaveValue('12.34');
  });

  /*
   * The symbol marks the field the form is about. Seven smaller money inputs deliberately go
   * without it — see the note on currencySymbol — so its presence here is a decision, not decoration.
   */
  it('is marked as money', () => {
    open();
    expect(screen.getByText('$')).toBeInTheDocument();
  });
});
