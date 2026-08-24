import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, GroupMember } from '../lib/groups';
import type { Expense } from '../lib/expenses';
import type { Settlement, SuggestedPayment } from '../lib/settlements';

/**
 * The one number at the top of the page.
 *
 * Almost everything worth testing here is a choice between four readings of the same ledger, and
 * the two that are easy to conflate are the interesting ones: being square yourself is not the same
 * as the group being clear, and a group that has never spent anything is neither. Getting those
 * wrong congratulates somebody for settling a tab that was never opened, or tells them everyone is
 * done while two other people still owe each other money.
 */

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./Toast', () => ({ useToast: () => toastStub }));

const balance = (userId: string, displayName: string, netCents: number): Balance =>
  ({ userId, displayName, netCents, paidCents: 0, owedCents: 0 });

const expense = (id: string, amountCents: number, date = '2026-08-10T12:00:00.000Z'): Expense => ({
  id, description: 'Dinner', amountCents, payerId: 'a', splitMethod: 'EQUAL', category: 'food',
  createdAt: date, date, note: null, version: 1,
  splits: [{ userId: 'a', owedCents: 0 }, { userId: 'b', owedCents: 0 }],
});

const settlement = (id: string, amountCents: number): Settlement =>
  ({ id, fromUserId: 'b', toUserId: 'a', amountCents, method: 'venmo', createdAt: '2026-08-11T12:00:00.000Z' });

const OWED: SuggestedPayment = { fromUserId: 'b', fromName: 'Bob', toUserId: 'a', toName: 'Alice', amountCents: 3_000 };

const onLogPayment = vi.fn();
const onOpenMembers = vi.fn();

/** Only the count and the names matter to this component; the strip reads both. */
const roster = (...names: string[]): GroupMember[] =>
  names.map((displayName, i) => ({
    userId: String.fromCharCode(97 + i),
    displayName,
    email: null,
    role: 'MEMBER' as const,
    joinedAt: '2026-08-01T00:00:00.000Z',
    isPlaceholder: false,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
  }));

async function open(over: Record<string, unknown> = {}) {
  const { BalanceHero } = await import('./BalanceHero');
  render(
    <BalanceHero
      groupName="Tahoe"
      balances={[balance('a', 'Alice', 3_000), balance('b', 'Bob', -3_000)]}
      expenses={[expense('e1', 6_000)]}
      settlements={[]}
      suggested={[OWED]}
      currentUserId="a"
      members={roster('Alice', 'Bob')}
      onLogPayment={onLogPayment}
      onOpenMembers={onOpenMembers}
      {...over}
    />,
  );
  return userEvent.setup();
}

/** A ledger where nothing has happened at all. */
const EMPTY = { balances: [], expenses: [], settlements: [], suggested: [] };
/** You are square, but Bob and Cara still owe each other. */
const SQUARE_BUT_NOT_DONE = {
  balances: [balance('a', 'Alice', 0), balance('b', 'Bob', -2_000), balance('c', 'Cara', 2_000)],
  suggested: [{ fromUserId: 'b', fromName: 'Bob', toUserId: 'c', toName: 'Cara', amountCents: 2_000 }],
  members: roster('Alice', 'Bob', 'Cara'),
};
/** Nobody owes anybody. */
const ALL_CLEAR = {
  balances: [balance('a', 'Alice', 0), balance('b', 'Bob', 0)],
  suggested: [],
  settlements: [settlement('s1', 3_000)],
};

beforeEach(() => {
  onLogPayment.mockReset();
});

describe('which of the four things it says', () => {
  it('states your position when you are owed', async () => {
    await open();
    expect(screen.getByText("You're owed")).toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
  });

  it('states it the other way round when you owe', async () => {
    await open({ currentUserId: 'b' });
    expect(screen.getByText('You owe')).toBeInTheDocument();
    expect(screen.getByText('$30.00')).toBeInTheDocument();
  });

  /*
   * The distinction that matters. Being square is about you; being clear is about the group. Saying
   * "All settled" while Bob still owes Cara would be wrong on the one screen people check to find
   * out whether they are done.
   */
  it('will not call the group clear just because you are square', async () => {
    await open(SQUARE_BUT_NOT_DONE);
    expect(screen.getByText("You're square")).toBeInTheDocument();
    expect(screen.getByText('Your standing here')).toBeInTheDocument();
    expect(screen.queryByText('All settled')).not.toBeInTheDocument();
    expect(screen.getByText('$20.00 still unsettled across the group')).toBeInTheDocument();
  });

  it('calls it settled once nobody owes anybody', async () => {
    await open(ALL_CLEAR);
    expect(screen.getByText('All settled')).toBeInTheDocument();
    expect(screen.getByText('Everyone is clear')).toBeInTheDocument();
  });

  // A group that has never spent anything is not settled, it has not started. No mark for that.
  it('says nothing has happened yet rather than congratulating an empty tab', async () => {
    await open(EMPTY);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByText('All settled')).not.toBeInTheDocument();
    expect(screen.getByText('Add an expense to get the tab going.')).toBeInTheDocument();
  });

  it('points a group of one at the thing it actually needs', async () => {
    await open({ ...EMPTY, members: roster('Alice') });
    expect(screen.getByText('Just you so far')).toBeInTheDocument();
    expect(screen.getByText('First, add the people')).toBeInTheDocument();
  });
});

describe('the settle-up progress bar', () => {
  it('reads payments made against money still outstanding', async () => {
    // $30 paid back, $30 still owed: halfway.
    await open({ settlements: [settlement('s1', 3_000)] });
    expect(screen.getByRole('progressbar', { name: 'Settle-up progress' })).toHaveAttribute('aria-valuenow', '50');
  });

  /*
   * A manual payment can deliberately overpay an earlier split, which would otherwise push this past
   * 100 and make a perfectly valid ledger look broken.
   */
  it('does not run past the end when somebody overpays', async () => {
    await open({ ...ALL_CLEAR, settlements: [settlement('s1', 99_000)] });
    expect(screen.getByRole('progressbar', { name: 'Settle-up progress' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('stays away before anything has been paid or owed', async () => {
    await open(EMPTY);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('what it offers you next', () => {
  it('offers to log a payment while there is something to settle', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Log a payment/ }));
    expect(onLogPayment).toHaveBeenCalled();
  });

  // Nothing to log against, and nobody to log it with.
  it('withholds it from a group of one, saying why', async () => {
    await open({ ...EMPTY, members: roster('Alice'), expenses: [expense('e1', 100)] });
    expect(screen.queryByRole('button', { name: /Log a payment/ })).not.toBeInTheDocument();
    expect(screen.getByText('Add someone else before you can log a payment.')).toBeInTheDocument();
  });

  it('withholds it once the group is clear', async () => {
    await open(ALL_CLEAR);
    expect(screen.queryByRole('button', { name: /Log a payment/ })).not.toBeInTheDocument();
  });
});

describe('sharing your balance', () => {
  it('says which way round it is', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = await open({ currentUserId: 'b' });
    await user.click(screen.getByRole('button', { name: /Send my balance/ }));
    expect(share.mock.calls[0]![0].text).toContain('I still owe $30.00');
    Reflect.deleteProperty(navigator, 'share');
  });

  // There is nothing to chase, so the button would only ever produce an awkward message.
  it('is not offered when you are square', async () => {
    await open(SQUARE_BUT_NOT_DONE);
    expect(screen.queryByRole('button', { name: /Send my balance/ })).not.toBeInTheDocument();
  });
});
