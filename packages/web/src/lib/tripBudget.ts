import type { MoneyFormatter } from '@owewell/shared';
import { todayStr } from './format';

/*
 * Going past the number is a fact, not a failure, and never coloured as a warning.
 *
 * No projected total: that needs a trip end date the app does not have, and "on track to spend $4,000"
 * is a bad thing to be wrong about.
 */

export interface TripBudget {
  budgetCents: number;
  spentCents: number;
  /** Negative once the group has gone past the number, which is a normal thing to have happened. */
  remainingCents: number;
  /** 0-1 and uncapped, so a bar can clamp it while the copy stays honest about 130%. */
  used: number;
  /** Whole days since the first expense, at least 1, for a rate that is not divided by zero. */
  days: number;
  /** Null when there is nobody to divide by, which happens in a group of one. */
  perPersonCents: number | null;
  /** Null until there is more than one day of history, since a one-day average is just the total. */
  perDayCents: number | null;
}

interface DatedAmount {
  /** YYYY-MM-DD, compared as a string so a UTC parse cannot shift the day. */
  date: string;
  amountCents: number;
}

const DAY_MS = 86_400_000;

/** Midnight UTC for a YYYY-MM-DD, so day counts are calendar days rather than elapsed hours. */
function dayStart(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

export function tripBudget(
  budgetCents: number | null,
  expenses: readonly DatedAmount[],
  memberCount: number,
  now = new Date(),
): TripBudget | null {
  if (budgetCents === null || budgetCents <= 0) return null;

  let spentCents = 0;
  let earliest = Number.POSITIVE_INFINITY;
  for (const expense of expenses) {
    spentCents += expense.amountCents;
    const at = dayStart(expense.date);
    // No NaN guard needed: `NaN < earliest` is false, so an unparseable date never wins this comparison.
    if (at < earliest) earliest = at;
  }

  // From the first expense, not the group: three weeks of nothing before the trip dilutes the rate.
  const today = dayStart(todayStr(now));
  // Clamped: the date field accepts future dates, and a trip of zero days divides the rate by zero.
  const days = Number.isFinite(earliest) ? Math.max(1, Math.round((today - earliest) / DAY_MS) + 1) : 1;

  return {
    budgetCents,
    spentCents,
    remainingCents: budgetCents - spentCents,
    used: spentCents / budgetCents,
    days,
    perPersonCents: memberCount > 0 ? Math.round(spentCents / memberCount) : null,
    // One day of history makes the average equal to the total, which is a statistic that says nothing.
    perDayCents: days > 1 ? Math.round(spentCents / days) : null,
  };
}

/** No alarm state. `close` lets the bar change without the copy changing: the useful moment is noticing
 *  you are near the number, not being told off after. */
export type BudgetTone = 'fine' | 'close' | 'past';

export function budgetTone(budget: TripBudget): BudgetTone {
  if (budget.remainingCents < 0) return 'past';
  return budget.used >= 0.8 ? 'close' : 'fine';
}

/** Past the number it states the amount and stops: no "over budget", no suggestion anybody act on it. */
export function budgetLine(budget: TripBudget, fmt: MoneyFormatter): string {
  const spent = fmt(budget.spentCents);
  const total = fmt(budget.budgetCents);
  if (budget.remainingCents < 0) {
    return `${spent} of the ${total} you set, plus ${fmt(-budget.remainingCents)}.`;
  }
  return `${spent} of ${total}, so ${fmt(budget.remainingCents)} still to play with.`;
}

/** The group total is the alarming number; the per-person one is the actionable one. Show both. */
export function budgetDetail(budget: TripBudget, fmt: MoneyFormatter): string | null {
  const parts: string[] = [];
  if (budget.perPersonCents !== null) parts.push(`${fmt(budget.perPersonCents)} each so far`);
  if (budget.perDayCents !== null) parts.push(`about ${fmt(budget.perDayCents)} a day`);
  return parts.length > 0 ? parts.join(', ') : null;
}
