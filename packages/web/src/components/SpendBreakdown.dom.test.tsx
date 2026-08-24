import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '../lib/expenses';
import { SpendBreakdown } from './SpendBreakdown';

/**
 * Where the money went, now sitting above the list it filters.
 *
 * Tapping a category used to set a filter and throw you to another tab to see the result. The
 * interaction is local now, so what is worth pinning is that the disclosure earns its row when
 * closed, and that selecting still round-trips through the page — the filter is shared with the
 * feed, so this component reports rather than decides.
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

async function open(over: Record<string, unknown> = {}) {
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

const disclosure = () => screen.getByRole('button', { name: /Where it went/ });

beforeEach(() => onSelectCategory.mockReset());

describe('closed', () => {
  /*
   * A row that only says "Where it went" next to a chevron is furniture. Closed, it reports the
   * biggest category and its share, so it is worth the line whether or not anybody opens it.
   */
  it('still says something', async () => {
    await open();
    expect(disclosure()).toHaveTextContent('mostly Food & Drink, 67%');
  });

  it('names the active filter instead, once there is one', async () => {
    await open({ categoryFilter: 'transport' });
    expect(disclosure()).toHaveTextContent('Transport · $24.00');
  });

  it('keeps the chart out of the way until asked', async () => {
    await open();
    expect(screen.queryByRole('button', { name: /Filter activity by/ })).not.toBeInTheDocument();
  });
});

describe('open', () => {
  it('offers a bar per category', async () => {
    const user = await open();
    await user.click(disclosure());
    expect(screen.getByRole('button', { name: /Filter activity by Food & Drink/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filter activity by Transport/ })).toBeInTheDocument();
  });

  it('reports a pick rather than filtering itself', async () => {
    const user = await open();
    await user.click(disclosure());
    await user.click(screen.getByRole('button', { name: /Filter activity by Food & Drink/ }));
    expect(onSelectCategory).toHaveBeenCalledWith('food');
  });

  // The label says "clear", so it has to clear — this was a real bug in the old chart.
  it('clears when the active category is picked again', async () => {
    const user = await open({ categoryFilter: 'food' });
    await user.click(disclosure());
    await user.click(screen.getByRole('button', { name: /Clear filter Food & Drink/ }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it('switches to the donut', async () => {
    const user = await open();
    await user.click(disclosure());
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
