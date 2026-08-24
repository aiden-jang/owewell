import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '../lib/expenses';
import { SpendBreakdown } from './SpendBreakdown';

/**
 * Where the money went, now sitting above the list it filters.
 *
 * Tapping a category used to set a filter and throw you to another tab to see the result. The
 * interaction is local now, so what is worth pinning is that selecting round-trips through the page
 * — the filter is shared with the feed, so this component reports rather than decides.
 */

const expense = (id: string, amountCents: number, category: string): Expense => ({
  id, description: id, amountCents, payerId: 'a', splitMethod: 'EQUAL', category: category as never,
  createdAt: '2026-08-10T12:00:00.000Z', date: '2026-08-10T12:00:00.000Z', note: null, version: 1, splits: [{ userId: 'a', owedCents: amountCents }],
});

const EXPENSES = [
  expense('e1', 8_000, 'food'),
  expense('e2', 2_400, 'transport'),
  expense('e3', 1_600, 'groceries'),
];

const onSelectCategory = vi.fn();

function show(over: Record<string, unknown> = {}) {
  render(
    <SpendBreakdown
      expenses={EXPENSES}
      categoryFilter={null}
      onSelectCategory={onSelectCategory}
      {...over}
    />,
  );
  return userEvent.setup();
}

beforeEach(() => onSelectCategory.mockReset());

/*
 * No disclosure. It was collapsed while this page also carried a budget card, a settle-by card and a
 * monthly pulse; with those gone the chart is what the space is for, and the share link had been
 * rendering it open to guests the whole time.
 */
describe('the chart', () => {
  it('shows a bar per category without anyone asking for it', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Where it went' })).toBeInTheDocument();
    for (const label of ['Food & Drink', 'Transport', 'Groceries']) {
      expect(screen.getByRole('button', { name: new RegExp(`Filter activity by ${label}`) })).toBeInTheDocument();
    }
  });

  // The heading is a heading now, not a control. A button here would be the disclosure coming back.
  it('has nothing to expand', () => {
    show();
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument();
  });

  it('reports a pick rather than filtering itself', async () => {
    const user = show();
    await user.click(screen.getByRole('button', { name: /Filter activity by Food & Drink/ }));
    expect(onSelectCategory).toHaveBeenCalledWith('food');
  });

  // The label says "clear", so it has to clear — this was a real bug in the old chart.
  it('clears when the active category is picked again', async () => {
    const user = show({ categoryFilter: 'food' });
    await user.click(screen.getByRole('button', { name: /Clear filter Food & Drink/ }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it('switches to the donut', async () => {
    const user = show();
    await user.click(screen.getByRole('button', { name: 'donut' }));
    expect(screen.getByRole('button', { name: 'donut' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('when there is nothing to compare', () => {
  // One category is the total again with a bar under it, so the whole section stays away.
  it('renders nothing at all', () => {
    const { container } = render(
      <SpendBreakdown expenses={[EXPENSES[0]!]} categoryFilter={null} onSelectCategory={onSelectCategory} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with no expenses', () => {
    const { container } = render(
      <SpendBreakdown expenses={[]} categoryFilter={null} onSelectCategory={onSelectCategory} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
