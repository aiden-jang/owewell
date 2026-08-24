import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';
import type { Settlement } from '../lib/settlements';
import type { PendingRow } from './ActivityFeed';

/**
 * The ledger, driven.
 *
 * The feed is the screen people actually spend their time on, and most of what it does is subtractive:
 * search, a person lens, a category drill-down from the other tab, a cap on how much renders, and
 * three separate ways a queued write changes what a row says. Every one of those is a rule about what
 * you are NOT shown, which is the kind of thing that fails silently — a row quietly missing looks
 * exactly like a row that was never there.
 */

function expense(over: Partial<Expense> & { id: string; description: string; amountCents: number }): Expense {
  return {
    payerId: 'a',
    splitMethod: 'EQUAL',
    category: 'food',
    createdAt: '2026-08-10T12:00:00.000Z',
    date: '2026-08-10T12:00:00.000Z',
    note: null,
    hasReceipt: false,
    version: 1,
    splits: [{ userId: 'a', owedCents: 0 }, { userId: 'b', owedCents: 0 }],
    ...over,
  };
}

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

const MEMBERS = [member('a', 'Alice'), member('b', 'Bob'), member('c', 'Cara')];

const DINNER = expense({
  id: 'e1',
  description: 'Dinner at Nopa',
  amountCents: 8_000,
  payerId: 'a',
  splits: [{ userId: 'a', owedCents: 4_000 }, { userId: 'b', owedCents: 4_000 }],
});
const CAB = expense({
  id: 'e2',
  description: 'Cab home',
  amountCents: 2_400,
  payerId: 'b',
  category: 'transport',
  date: '2026-08-09T12:00:00.000Z',
  splits: [{ userId: 'b', owedCents: 1_200 }, { userId: 'c', owedCents: 1_200 }],
});
const PAYMENT: Settlement = {
  id: 's1',
  fromUserId: 'b',
  toUserId: 'a',
  amountCents: 4_000,
  method: 'venmo',
  createdAt: '2026-08-11T12:00:00.000Z',
};

const onCategoryFilter = vi.fn();
const onOpenExpense = vi.fn();
const onUndoSettlement = vi.fn<(id: string) => Promise<void>>();
const onAddExpense = vi.fn();

async function open(over: Record<string, unknown> = {}) {
  const { ActivityFeed } = await import('./ActivityFeed');
  render(
    <ActivityFeed
      expenses={[DINNER, CAB]}
      settlements={[PAYMENT]}
      members={MEMBERS}
      currentUserId="a"
      pendingRows={[]}
      pendingDeletes={new Set()}
      pendingEdits={new Set()}
      categoryFilter={null}
      onCategoryFilter={onCategoryFilter}
      onOpenExpense={onOpenExpense}
      onUndoSettlement={onUndoSettlement}
      onAddExpense={onAddExpense}
      {...over}
    />,
  );
  return userEvent.setup();
}

const rowTexts = () => screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
const search = () => screen.getByRole('searchbox');

beforeEach(() => {
  for (const fn of [onCategoryFilter, onOpenExpense, onAddExpense]) fn.mockReset();
  onUndoSettlement.mockReset().mockResolvedValue(undefined);
});

describe('what the feed shows', () => {
  it('interleaves expenses and payments, newest first', async () => {
    await open();
    expect(rowTexts().map((t) => t.slice(0, 20))).toEqual([
      expect.stringContaining('Bob'), // the payment, 8/11
      expect.stringContaining('Dinner'), // 8/10
      expect.stringContaining('Cab'), // 8/9
    ]);
  });

  it('credits whoever actually paid', async () => {
    await open();
    expect(screen.getByText(/Alice paid/)).toBeInTheDocument();
    expect(screen.getByText(/Bob paid/)).toBeInTheDocument();
  });

  /*
   * An itemized receipt where people paid for their own items is not "Alice paid" — she covered one
   * line of it. Reading the per-item payers keeps a split tab honest.
   */
  it('names both payers on a split-tab receipt, and counts them past two', async () => {
    const twoPayers = expense({
      id: 'e3',
      description: 'Split tab',
      amountCents: 5_000,
      splitMethod: 'ITEMIZED',
      items: [
        { name: 'Beer', amountCents: 2_000, participantIds: ['a'], payerId: 'a' },
        { name: 'Wine', amountCents: 3_000, participantIds: ['b'], payerId: 'b' },
      ],
    });
    await open({ expenses: [twoPayers], settlements: [] });
    expect(screen.getByText(/Alice & Bob paid/)).toBeInTheDocument();
  });

  it('flags a split that did not include everyone', async () => {
    await open();
    // Dinner is 2 of the 3 members; the row says so rather than leaving it to be inferred.
    const dinner = screen.getByText(/Dinner at Nopa/).closest('li')!;
    expect(within(dinner).getByText(/2 ways/)).toBeInTheDocument();
  });

  it('says nothing when everyone was in on it', async () => {
    const allThree = expense({
      id: 'e4',
      description: 'Groceries',
      amountCents: 6_000,
      splits: MEMBERS.map((m) => ({ userId: m.userId, owedCents: 2_000 })),
    });
    await open({ expenses: [allThree], settlements: [] });
    expect(screen.queryByText(/ways/)).not.toBeInTheDocument();
  });
});

describe('search', () => {
  it('matches the description', async () => {
    const user = await open();
    await user.type(search(), 'nopa');
    expect(rowTexts()).toHaveLength(1);
    expect(screen.getByText(/Dinner at Nopa/)).toBeInTheDocument();
  });

  it('matches a person who is only on the split, not just the payer', async () => {
    const user = await open();
    await user.type(search(), 'Cara');
    // Cara paid for nothing; she is a participant on the cab.
    expect(rowTexts()).toHaveLength(1);
    expect(screen.getByText(/Cab home/)).toBeInTheDocument();
  });

  // What people actually type when hunting for a charge they half-remember.
  it('matches the formatted amount and the category label', async () => {
    const user = await open();
    await user.type(search(), '$24.00');
    expect(rowTexts()).toHaveLength(1);

    await user.clear(search());
    await user.type(search(), 'transport');
    expect(rowTexts()).toHaveLength(1);
  });

  it('reaches payments too, by name and by method', async () => {
    const user = await open();
    await user.type(search(), 'venmo');
    expect(rowTexts()).toHaveLength(1);
    expect(screen.getByLabelText('Undo payment')).toBeInTheDocument();
  });

  it('counts the results and offers a way out', async () => {
    const user = await open();
    await user.type(search(), 'nopa');
    expect(screen.getByText('1 result')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(rowTexts()).toHaveLength(3);
  });
});

describe('the person lens', () => {
  /*
   * Filters are about expenses, so a payment cannot match one. Letting settlements through a person
   * filter would answer a different question than the one asked.
   */
  it('drops payments as soon as any filter is on', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Filter by person'), 'c');
    expect(screen.queryByLabelText('Undo payment')).not.toBeInTheDocument();
    expect(rowTexts()).toHaveLength(1);
  });

  it('narrows further by what that person did', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Filter by person'), 'c');
    // Cara owes on the cab but paid for nothing.
    await user.selectOptions(screen.getByLabelText('Filter by relationship to the expense'), 'paid');
    expect(screen.queryByText(/Cab home/)).not.toBeInTheDocument();
  });

  it('offers the relationship choice only once a person is picked', async () => {
    const user = await open();
    expect(screen.queryByLabelText('Filter by relationship to the expense')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by person'), 'b');
    expect(screen.getByLabelText('Filter by relationship to the expense')).toBeInTheDocument();
  });

  /*
   * The total above the feed follows the lens, and the two lenses ask different questions. "Involved"
   * is which expenses she was part of, so it totals the whole cab fare; "owes" is what she is on the
   * hook for, so it totals her share of it. The word beside the number changes to match.
   */
  it('retotals the header to whichever question the lens asks', async () => {
    const user = await open();
    expect(screen.getByText(/spent/)).toHaveTextContent('$104.00 spent');

    await user.selectOptions(screen.getByLabelText('Filter by person'), 'c');
    expect(screen.getByText(/spent/)).toHaveTextContent('$24.00 spent');

    await user.selectOptions(screen.getByLabelText('Filter by relationship to the expense'), 'owes');
    expect(screen.getByText(/owed/)).toHaveTextContent('$12.00 owed');
  });
});

describe('the category drill-down from the other tab', () => {
  // Controlled, not owned: the spend chart on Summary sets it and switches you here, so clearing it
  // has to go back out rather than being handled locally.
  it('shows the chip and hands the clear back to the page', async () => {
    const user = await open({ categoryFilter: 'transport' });
    expect(rowTexts()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Clear Transport filter/i }));
    expect(onCategoryFilter).toHaveBeenCalledWith(null);
  });

  it('clears it along with everything else', async () => {
    const user = await open({ categoryFilter: 'transport' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onCategoryFilter).toHaveBeenCalledWith(null);
  });
});

describe('writes that have not reached the server', () => {
  it('shows a queued expense above the ledger and says it is not counted', async () => {
    const queued = [
      { kind: 'expense', clientId: 'q1', groupId: 'g1', description: 'Ferry', amountCents: 900 } as unknown as PendingRow,
    ];
    await open({ pendingRows: queued });
    expect(rowTexts()[0]).toContain('Ferry');
    expect(screen.getByText(/not counted yet/)).toBeInTheDocument();
  });

  /*
   * The row goes immediately, before the delete has been sent. Leaving it would mean the feed showed
   * something the balances above no longer include, with nothing on screen to explain the gap.
   */
  it('hides a row whose delete is still queued', async () => {
    await open({ pendingDeletes: new Set(['e1']) });
    expect(screen.queryByText(/Dinner at Nopa/)).not.toBeInTheDocument();
    expect(rowTexts()).toHaveLength(2);
  });

  // The queued payload is form values, not a computed split, so the row keeps showing the server's
  // numbers and says a change is coming instead of faking one.
  it('keeps the old numbers on a row whose edit is queued, and says so', async () => {
    await open({ pendingEdits: new Set(['e1']) });
    expect(screen.getByText('Your change is waiting for signal')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
  });
});

describe('how much renders', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    expense({ id: `x${i}`, description: `Item ${i}`, amountCents: 100, date: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z` }),
  );

  it('caps the feed and offers the rest', async () => {
    await open({ expenses: many, settlements: [] });
    expect(rowTexts()).toHaveLength(50);
    expect(screen.getByRole('button', { name: 'Show 10 older entries' })).toBeInTheDocument();
  });

  it('shows them all on request', async () => {
    const user = await open({ expenses: many, settlements: [] });
    await user.click(screen.getByRole('button', { name: 'Show 10 older entries' }));
    expect(rowTexts()).toHaveLength(60);
    expect(screen.queryByRole('button', { name: /older/ })).not.toBeInTheDocument();
  });

  /*
   * Searching still reaches everything, not just the fifty on screen — the cap is on the scroll, not
   * on what is searchable. A match from last March has to be findable.
   */
  it('searches past the cap', async () => {
    const user = await open({ expenses: many, settlements: [] });
    await user.type(search(), 'Item 59');
    expect(rowTexts()).toHaveLength(1);
  });

  // A new query is a new question, so it starts from the top rather than dumping every match at once.
  it('recollapses when the question changes', async () => {
    const user = await open({ expenses: many, settlements: [] });
    await user.click(screen.getByRole('button', { name: 'Show 10 older entries' }));
    await user.type(search(), 'Item');
    expect(rowTexts()).toHaveLength(50);
  });
});

describe('when there is nothing to show', () => {
  it('offers the first expense when the group is empty', async () => {
    const user = await open({ expenses: [], settlements: [] });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add expense/ }));
    expect(onAddExpense).toHaveBeenCalled();
  });

  it('says what was searched for when a filter empties a real ledger', async () => {
    const user = await open();
    await user.type(search(), 'zzz');
    expect(screen.getByText(/Nothing in this ledger matches/)).toHaveTextContent('“zzz”');
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(rowTexts()).toHaveLength(3);
  });
});

describe('acting on a row', () => {
  it('opens the detail sheet for an expense', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Dinner at Nopa, \$80\.00\. See details\./ }));
    expect(onOpenExpense).toHaveBeenCalledWith('e1');
  });

  it('undoes a payment', async () => {
    const user = await open();
    await user.click(screen.getByLabelText('Undo payment'));
    expect(onUndoSettlement).toHaveBeenCalledWith('s1');
  });
});
