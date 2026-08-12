import { Money } from '@owewell/shared';
import { todayStr } from './format';

/*
 * A number the group picked, and how the spending sits against it.
 *
 * The reason this is worth being careful about: a budget is the one place a bill splitter turns into a
 * scold. Every app that has tried this ends up with a red bar and the words OVER BUDGET, which tells four
 * people on holiday something they already know in the tone of a parking fine. Nothing here raises its
 * voice, nothing is coloured like a warning, and going past the number is reported as a fact rather than
 * a failure. The group set the number; the group can decide how it feels about it.
 *
 * There is deliberately no projection of a final total. That would need a trip end date, which the app
 * does not know: `settleBy` is when everybody pays up, which is usually after people have gone home. A
 * projection built on a guessed end date is confidently wrong, and "you're on track to spend $4,000" is a
 * much worse thing to be wrong about than saying nothing.
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

  /*
   * Counted from the first expense rather than from when the group was made.
   *
   * A group created three weeks before the trip would otherwise report a daily rate diluted by three
   * weeks of nothing, and "$40 a day" for a trip that has not started yet is not a fact about anything.
   */
  const today = dayStart(todayStr(now));
  /*
   * Clamped, because the date field accepts future dates.
   *
   * Somebody booking tomorrow's ferry today gives an earliest date after today, and an unclamped count
   * goes to zero or negative: a trip of zero days divides the daily rate by zero and reports Infinity.
   */
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

/**
 * How the bar should read, which is not the same question as how much is left.
 *
 * Three states and no alarm state. `close` exists so the bar can change without the copy changing, since
 * the useful moment is noticing you are near the number, and the useless one is being told off after.
 */
export type BudgetTone = 'fine' | 'close' | 'past';

export function budgetTone(budget: TripBudget): BudgetTone {
  if (budget.remainingCents < 0) return 'past';
  return budget.used >= 0.8 ? 'close' : 'fine';
}

/**
 * The headline, in the app's voice.
 *
 * Lowercase and flat on purpose. Past the number it says what is true and stops: no "over budget", no
 * "exceeded", no suggestion that anybody should do something about it. If four people decide the trip was
 * worth an extra two hundred, the app has no opinion about that.
 */
export function budgetLine(budget: TripBudget): string {
  const spent = Money.fromCents(budget.spentCents).format();
  const total = Money.fromCents(budget.budgetCents).format();
  if (budget.remainingCents < 0) {
    return `${spent} of the ${total} you set, plus ${Money.fromCents(-budget.remainingCents).format()}.`;
  }
  return `${spent} of ${total}, so ${Money.fromCents(budget.remainingCents).format()} still to play with.`;
}

/**
 * The quieter second line: what the total actually means for one person, and the daily rate.
 *
 * A group total is the number that sounds alarming and the per-person number is the one anybody can act
 * on, so both are shown rather than making people divide in their heads on holiday.
 */
export function budgetDetail(budget: TripBudget): string | null {
  const parts: string[] = [];
  if (budget.perPersonCents !== null) parts.push(`${Money.fromCents(budget.perPersonCents).format()} each so far`);
  if (budget.perDayCents !== null) parts.push(`about ${Money.fromCents(budget.perDayCents).format()} a day`);
  return parts.length > 0 ? parts.join(', ') : null;
}
