import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TripBudget } from './TripBudget';
import { tripBudget } from '../lib/tripBudget';

/**
 * The budget control, rendered.
 *
 * The pure module is tested next door; what cannot be seen from there is who gets which controls and what
 * the bar actually does when the group goes past the number. Both are the kind of thing that only shows up
 * on a real trip, which is the worst time to find out that a member can quietly move everybody's budget.
 */

const budgetOf = (spentDollars: number, budgetDollars = 1_000) =>
  tripBudget(
    budgetDollars * 100,
    [{ date: '2026-08-01', amountCents: spentDollars * 100 }],
    4,
    new Date(2026, 7, 1, 12),
  );

describe('who can change the number', () => {
  it('offers the owner a way to set one', () => {
    render(<TripBudget budget={null} budgetCents={null} isOwner onSave={vi.fn()} />);
    expect(screen.getByText('Set a budget for the trip')).toBeInTheDocument();
  });

  it('shows a member nothing at all when no budget is set', () => {
    // Not a disabled control: an empty box offering something you cannot do is worse than no box.
    const { container } = render(<TripBudget budget={null} budgetCents={null} isOwner={false} onSave={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a member the budget without the controls to change it', () => {
    render(<TripBudget budget={budgetOf(200)} budgetCents={100_000} isOwner={false} onSave={vi.fn()} />);
    expect(screen.getByText(/\$200\.00 of \$1,000\.00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});

describe('the bar', () => {
  it('reports how much of the budget is gone', () => {
    render(<TripBudget budget={budgetOf(250)} budgetCents={100_000} isOwner onSave={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '25');
  });

  /*
   * The whole reason this component was worth writing carefully.
   *
   * A bar that runs off the end of its track is a rendering bug, and one that reads 130% to a screen
   * reader while showing a full bar is a lie. It clamps, and the text next to it stays honest.
   */
  it('clamps past the number without pretending the group is on budget', () => {
    render(<TripBudget budget={budgetOf(1_300)} budgetCents={100_000} isOwner onSave={vi.fn()} />);
    const bar = screen.getByRole('progressbar', { name: 'Budget used' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining('plus $300.00'));
  });

  it('says so plainly before anything has been spent', () => {
    render(<TripBudget budget={null} budgetCents={100_000} isOwner onSave={vi.fn()} />);
    expect(screen.getByText('$1,000.00, nothing spent yet.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('setting one', () => {
  it('sends cents rather than the typed dollars', async () => {
    // The API takes cents like every other money field here; sending 750 would set a budget of $7.50.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TripBudget budget={null} budgetCents={null} isOwner onSave={onSave} />);
    await userEvent.click(screen.getByText('Set a budget for the trip'));
    await userEvent.type(screen.getByLabelText('Budget amount'), '750');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(onSave).toHaveBeenCalledWith(75_000);
  });

  it('keeps a mistyped amount in the field instead of throwing a toast at it', async () => {
    const onSave = vi.fn();
    render(<TripBudget budget={null} budgetCents={null} isOwner onSave={onSave} />);
    await userEvent.click(screen.getByText('Set a budget for the trip'));
    await userEvent.type(screen.getByLabelText('Budget amount'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Budget amount')).toHaveValue('lots');
  });

  it('refuses a budget of nothing, which the server would refuse anyway', async () => {
    const onSave = vi.fn();
    render(<TripBudget budget={null} budgetCents={null} isOwner onSave={onSave} />);
    await userEvent.click(screen.getByText('Set a budget for the trip'));
    await userEvent.type(screen.getByLabelText('Budget amount'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('holds onto what was typed when the save fails', async () => {
    // Losing a typed amount to a dropped connection is the small rudeness that makes people stop bothering.
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    render(<TripBudget budget={null} budgetCents={null} isOwner onSave={onSave} />);
    await userEvent.click(screen.getByText('Set a budget for the trip'));
    await userEvent.type(screen.getByLabelText('Budget amount'), '750');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(screen.getByLabelText('Budget amount')).toHaveValue('750.00');
  });

  it('clears by sending null, not zero', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TripBudget budget={budgetOf(200)} budgetCents={100_000} isOwner onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('opens the editor on the current amount rather than empty', async () => {
    render(<TripBudget budget={budgetOf(200)} budgetCents={100_000} isOwner onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Budget amount')).toHaveValue('1000.00');
  });
});
