import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Expense, GroupMember } from '@owewell/core';
import { ExpenseDetail } from './ExpenseDetail';

/**
 * The sheet behind an expense row.
 *
 * Everything you can do to an expense now lives in here, so the two things worth pinning down are that
 * the numbers it shows are the stored ones rather than a recomputation, and that a locked ledger really
 * does withhold edit and delete. The second is a permission, and a permission that only holds in the
 * component you remembered to check is not one.
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

const MEMBERS = [member('u1', 'Alice'), member('u2', 'Bob'), member('u3', 'Cleo'), member('u4', 'Dev')];

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  description: 'Dinner',
  amountCents: 9_000,
  payerId: 'u1',
  splitMethod: 'EQUAL',
  category: 'food',
  createdAt: '2026-08-11T18:00:00.000Z',
  date: '2026-08-11T18:00:00.000Z',
  note: null,
  splits: [
    { userId: 'u1', owedCents: 3_000 },
    { userId: 'u2', owedCents: 3_000 },
    { userId: 'u3', owedCents: 3_000 },
  ],
  ...over,
});

const props = {
  members: MEMBERS,
  viewerId: 'u2',
  locked: false,
  archived: false,
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
};

describe('what the sheet says', () => {
  it('leads with the total and the reader’s own share', () => {
    render(<ExpenseDetail {...props} expense={expense()} />);
    expect(screen.getByText('$90.00')).toBeInTheDocument();
    expect(screen.getByText(/Your share is/)).toBeInTheDocument();
    expect(screen.getByText('$30.00', { selector: 'span.font-semibold' })).toBeInTheDocument();
  });

  it('tells the payer they are the payer instead of asking them for their share', () => {
    render(<ExpenseDetail {...props} viewerId="u1" expense={expense()} />);
    expect(screen.getByText(/You paid, and your share is/)).toBeInTheDocument();
  });

  it('shows every share, marked with who paid', () => {
    render(<ExpenseDetail {...props} expense={expense()} />);
    expect(screen.getByText('Split equally · 3 people')).toBeInTheDocument();
    const shares = within(screen.getByRole('list', { name: 'Every share' }));
    expect(shares.getByText(/Alice/)).toHaveTextContent('Alice · paid');
    expect(shares.getByText(/^You/)).toBeInTheDocument();
  });

  /*
   * Shares are shown in the units the payer typed.
   *
   * "2 shares" next to $40 is the answer to why one person owes twice another. Printing only the dollars
   * makes the split look arbitrary, which is the exact argument this sheet exists to end.
   */
  it('prints the weights behind a shares split', () => {
    render(
      <ExpenseDetail
        {...props}
        expense={expense({
          splitMethod: 'SHARES',
          amountCents: 8_000,
          splits: [
            { userId: 'u1', owedCents: 4_000, inputValue: 2 },
            { userId: 'u2', owedCents: 2_000, inputValue: 1 },
            { userId: 'u3', owedCents: 2_000, inputValue: 1 },
          ],
        })}
      />,
    );
    const shares = within(screen.getByRole('list', { name: 'Every share' }));
    expect(shares.getByText(/Alice/)).toHaveTextContent('2 shares');
    expect(shares.getByText(/^You/)).toHaveTextContent('1 share');
  });

  /*
   * The payer is named twice or not at all, never in between.
   *
   * Each share already carries a "paid" tag, so a payer line above the list is the same sentence again.
   * It comes back only for the case the list cannot express: somebody fronting a bill they take no
   * share of, who would otherwise appear nowhere in a sheet about the money they put up.
   */
  it('names a payer who took no share, and stays quiet when the list already said it', () => {
    const { rerender } = render(<ExpenseDetail {...props} expense={expense()} />);
    expect(screen.queryByText(/without taking a share/)).not.toBeInTheDocument();

    rerender(
      <ExpenseDetail
        {...props}
        expense={expense({
          payerId: 'u4',
          splits: [
            { userId: 'u1', owedCents: 3_000 },
            { userId: 'u2', owedCents: 3_000 },
            { userId: 'u3', owedCents: 3_000 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/paid without taking a share/)).toHaveTextContent(
      'Dev paid without taking a share',
    );
  });

  it('shows the note when there is one, and nothing when there is not', () => {
    const { rerender } = render(<ExpenseDetail {...props} expense={expense()} />);
    expect(screen.queryByText(/Mara/)).not.toBeInTheDocument();
    rerender(<ExpenseDetail {...props} expense={expense({ note: "Mara's birthday, she didn't pay" })} />);
    expect(screen.getByText("Mara's birthday, she didn't pay")).toBeInTheDocument();
  });

  it('breaks an itemized receipt back into its lines', () => {
    render(
      <ExpenseDetail
        {...props}
        expense={expense({
          splitMethod: 'ITEMIZED',
          amountCents: 5_500,
          taxCents: 400,
          tipCents: 1_000,
          items: [
            { name: 'Calamari', amountCents: 1_600, participantIds: ['u1'] },
            { name: 'Pasta', amountCents: 2_500, participantIds: ['u1', 'u2', 'u3'] },
          ],
        })}
      />,
    );
    const receipt = within(screen.getByRole('list', { name: 'Receipt lines' }));
    expect(receipt.getByText(/Calamari/)).toHaveTextContent('Alice');
    expect(receipt.getByText(/Pasta/)).toHaveTextContent('shared');
    expect(screen.getByText('Tip')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });
});

describe('what you can do from here', () => {
  it('offers duplicate, edit and delete on an open ledger', async () => {
    const onEdit = vi.fn();
    render(<ExpenseDetail {...props} onEdit={onEdit} expense={expense()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('withholds edit and delete once a payment is recorded, and says why', () => {
    render(<ExpenseDetail {...props} locked expense={expense()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // Duplicating writes a new expense rather than touching this one, so the lock has nothing to say.
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByText(/locked/)).toBeInTheDocument();
  });

  it('offers nothing at all in an archived group', () => {
    render(<ExpenseDetail {...props} archived expense={expense()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
