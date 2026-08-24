import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, GroupMember } from '../lib/groups';
import type { Expense } from '../lib/expenses';
import type { GroupRecap } from '../lib/groupRecap';
import type { Settlement } from '../lib/settlements';

/**
 * The summary tab, driven.
 *
 * Two things here are worth pinning down. The wrapped recap is the reward for finishing a tab, and
 * it is composed into a block of text meant to be pasted into a group chat — so what it says, and
 * that it survives someone dismissing the share sheet, matters more than how it looks. The spend
 * breakdown is the only way into the feed's category filter, and that filter lives on the page
 * rather than in either tab, so the wiring across is easy to get subtly wrong.
 */

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./Toast', () => ({ useToast: () => toastStub }));

const member = (userId: string, displayName: string): GroupMember => ({
  userId, displayName, email: null, role: 'MEMBER', joinedAt: '2026-08-01T00:00:00.000Z',
  isPlaceholder: false, venmoHandle: null, cashappCashtag: null, paypalHandle: null,
});
const MEMBERS = [member('a', 'Alice'), member('b', 'Bob'), member('c', 'Cara')];

const expense = (over: Partial<Expense> & { id: string; description: string; amountCents: number }): Expense => ({
  payerId: 'a', splitMethod: 'EQUAL', category: 'food', createdAt: '2026-08-10T12:00:00.000Z',
  date: '2026-08-10T12:00:00.000Z', note: null, hasReceipt: false, version: 1,
  splits: [{ userId: 'a', owedCents: 0 }, { userId: 'b', owedCents: 0 }], ...over,
});

const EXPENSES = [
  expense({ id: 'e1', description: 'Dinner at Nopa', amountCents: 8_000 }),
  expense({ id: 'e2', description: 'Cab home', amountCents: 2_400, category: 'transport' }),
];
const SETTLEMENTS: Settlement[] = [
  { id: 's1', fromUserId: 'b', toUserId: 'a', amountCents: 4_000, method: 'venmo', createdAt: '2026-08-11T12:00:00.000Z' },
];
const BALANCES: Balance[] = [
  { userId: 'a', displayName: 'Alice', netCents: 0, paidCents: 10_400, owedCents: 10_400 },
  { userId: 'b', displayName: 'Bob', netCents: 0, paidCents: 0, owedCents: 0 },
  { userId: 'c', displayName: 'Cara', netCents: 0, paidCents: 0, owedCents: 0 },
];
const RECAP: GroupRecap = {
  totalCents: 10_400,
  largest: { description: 'Dinner at Nopa', amountCents: 8_000 },
  topCategory: { label: 'Food', emoji: '🍽️', amountCents: 8_000 },
  daysOpen: 3,
};

const onSelectCategory = vi.fn();
const onSaveBudget = vi.fn<(cents: number | null) => Promise<void>>();

async function open(over: Record<string, unknown> = {}) {
  const { SummaryTab } = await import('./SummaryTab');
  render(
    <SummaryTab
      groupName="Tahoe"
      recap={RECAP}
      expenses={EXPENSES}
      settlements={SETTLEMENTS}
      balances={BALANCES}
      members={MEMBERS}
      budgetCents={null}
      isOwner
      categoryFilter={null}
      onSelectCategory={onSelectCategory}
      onSaveBudget={onSaveBudget}
      {...over}
    />,
  );
  return userEvent.setup();
}

const shareButton = () => screen.getByRole('button', { name: /wrapped/i });

/*
 * Patch the two share paths by property rather than replacing `navigator` wholesale: userEvent
 * installs its own clipboard stub on the real object during setup, and swapping the object out from
 * under it makes every click in the file fail for reasons that have nothing to do with sharing.
 */
const patched: string[] = [];
function stubNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    patched.push(key);
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

beforeEach(() => {
  onSelectCategory.mockReset();
  onSaveBudget.mockReset().mockResolvedValue(undefined);
  toastStub.error.mockReset();
});

afterEach(() => {
  for (const key of patched.splice(0)) {
    Reflect.deleteProperty(navigator, key);
  }
});

describe('the wrapped recap', () => {
  // Only exists once the group is settled and has something to look back on; the page decides that
  // and passes null otherwise, because the Balances tab reads the same answer to offer the link over.
  it('is absent while the tab is still live, without taking the rest of the page with it', async () => {
    await open({ recap: null });
    expect(screen.queryByText('The tab, wrapped')).not.toBeInTheDocument();
    expect(screen.getByText('Where it went')).toBeInTheDocument();
  });

  it('names the group and its four numbers', async () => {
    await open();
    expect(screen.getByText('Tahoe in four numbers')).toBeInTheDocument();
    expect(screen.getByText('$104.00')).toBeInTheDocument();
    expect(screen.getByText('Dinner at Nopa')).toBeInTheDocument();
    expect(screen.getByText('🍽️ Food')).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
  });
});

describe('sharing the recap', () => {
  /*
   * The text is the whole feature: it gets pasted into a group chat, so it has to stand alone. It
   * reports the totals and the highlights without replaying who owed whom, which is the one thing
   * nobody wants forwarded after the tab is closed.
   */
  it('composes a recap that reads on its own, and says nothing about individual balances', async () => {
    const user = await open();
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await user.click(shareButton());

    const { text } = share.mock.calls[0]![0];
    expect(text).toContain('Tahoe is all settled');
    expect(text).toContain('$104.00 split across 3 people');
    expect(text).toContain('1 payment recorded');
    expect(text).toContain('Top category: 🍽️ Food ($80.00)');
    expect(text).toContain('Biggest expense: Dinner at Nopa ($80.00)');
    expect(text).toContain('Tab open for 3 days');
    expect(text).not.toMatch(/owes|is owed/);
  });

  it('pluralises the payment count', async () => {
    const user = await open({ settlements: [...SETTLEMENTS, { ...SETTLEMENTS[0]!, id: 's2' }] });
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await user.click(shareButton());
    expect(share.mock.calls[0]![0].text).toContain('2 payments recorded');
  });

  it('confirms it went', async () => {
    const user = await open();
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Wrapped shared'));
  });

  // Dismissing the OS share sheet is a decision, not a failure. Falling through to the clipboard
  // would put something on it that nobody asked for.
  it('goes quiet when the share sheet is dismissed', async () => {
    const user = await open();
    const writeText = vi.fn();
    stubNavigator({
      share: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
      clipboard: { writeText },
    });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Share the wrapped tab'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard where there is no share sheet', async () => {
    const user = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: undefined, clipboard: { writeText } });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Wrapped copied'));
    expect(writeText.mock.calls[0]![0]).toContain('Tahoe is all settled');
  });

  it('says so when neither works', async () => {
    const user = await open();
    stubNavigator({ share: undefined, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await user.click(shareButton());
    await waitFor(() => expect(toastStub.error).toHaveBeenCalledWith('Could not share the settled recap.'));
  });
});

describe('where it went', () => {
  it('drills into the feed by category', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Food/ }));
    expect(onSelectCategory).toHaveBeenCalledWith('food');
  });

  /*
   * The button says "Clear filter Food" once Food is the active one, so it has to clear it. It used
   * to re-apply the same filter instead, which is invisible if you can see the highlight and a
   * plain lie if you are being read the label.
   */
  it('clears the filter when the active category is picked again', async () => {
    const user = await open({ categoryFilter: 'food' });
    await user.click(screen.getByRole('button', { name: 'Clear filter Food & Drink' }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it('clears from the donut too', async () => {
    const user = await open({ categoryFilter: 'food' });
    await user.click(screen.getByRole('button', { name: 'donut' }));
    await user.click(screen.getByRole('button', { name: 'Clear filter Food & Drink' }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it('marks the slice that is already driving the feed', async () => {
    await open({ categoryFilter: 'food' });
    expect(screen.getByRole('button', { name: /Food/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Transport/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('invites the first tap', async () => {
    await open();
    expect(screen.getByText('tap to see them')).toBeInTheDocument();
  });

  it('drops the hint once something is tapped', async () => {
    await open({ categoryFilter: 'food' });
    expect(screen.queryByText('tap to see them')).not.toBeInTheDocument();
  });

  it('switches between bars and the donut', async () => {
    const user = await open();
    expect(screen.getByRole('button', { name: 'bars' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'donut' }));
    expect(screen.getByRole('button', { name: 'donut' })).toHaveAttribute('aria-pressed', 'true');
  });

  // One category is not a breakdown, it is the total again with a bar under it.
  it('stays away when there is nothing to compare', async () => {
    await open({ expenses: [EXPENSES[0]!] });
    expect(screen.queryByText('Where it went')).not.toBeInTheDocument();
  });
});

describe('the rest of the tab', () => {
  // TripBudget has its own tests; what is worth checking here is that the save reaches the page
  // rather than being handled locally, since the budget lives on the group.
  it('hands a budget change back to the page', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Set a budget/ }));
    await user.type(screen.getByLabelText('Budget amount'), '500');
    await user.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(onSaveBudget).toHaveBeenCalledWith(50_000);
  });

  it('reports what the group has spent against its budget', async () => {
    await open({ budgetCents: 20_000 });
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '52');
  });
});
