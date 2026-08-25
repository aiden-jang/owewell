import { categoryMeta, type Expense } from '@owewell/core';

/**
 * The "person lens" used by the group's activity feed and "Where it went" breakdown: pick a person
 * and how they relate to an expense. Pure, framework-free, and unit-tested — the component just
 * feeds it state and renders the result.
 *
 *  - involved: the person paid it, or owes a share of it
 *  - owes:     the person has a share they didn't pay (so it feeds their balance)
 *  - paid:     the person paid it
 */
export type Relation = 'involved' | 'owes' | 'paid';

/** The person's owed share of an expense in cents (0 if they aren't a participant). */
export function shareOf(expense: Expense, personId: string): number {
  return expense.splits.find((s) => s.userId === personId)?.owedCents ?? 0;
}

/** Whether an expense matches the lens. A null person means "no lens" and matches everything. */
export function matchesPersonLens(expense: Expense, personId: string | null, relation: Relation): boolean {
  if (!personId) return true;
  const hasShare = shareOf(expense, personId) > 0;
  if (relation === 'paid') return expense.payerId === personId;
  if (relation === 'owes') return hasShare && expense.payerId !== personId;
  return expense.payerId === personId || hasShare; // involved
}

/** What an expense contributes under the lens: the person's share for "owes", else the full bill. */
export function lensAmount(expense: Expense, personId: string | null, relation: Relation): number {
  return personId && relation === 'owes' ? shareOf(expense, personId) : expense.amountCents;
}

/** Sum of the lens amount across the matching expenses. */
export function lensTotal(expenses: Expense[], personId: string | null, relation: Relation): number {
  return expenses.reduce(
    (sum, e) => (matchesPersonLens(e, personId, relation) ? sum + lensAmount(e, personId, relation) : sum),
    0,
  );
}

export interface CategorySpend {
  meta: ReturnType<typeof categoryMeta>;
  cents: number;
}

/** Spend grouped by category under the lens, biggest first, for the "Where it went" breakdown. */
export function spendByCategory(
  expenses: Expense[],
  personId: string | null,
  relation: Relation,
): CategorySpend[] {
  const totals = new Map<string, number>();
  for (const e of expenses) {
    if (!matchesPersonLens(e, personId, relation)) continue;
    const key = e.category ?? 'other';
    totals.set(key, (totals.get(key) ?? 0) + lensAmount(e, personId, relation));
  }
  return [...totals.entries()]
    .map(([key, cents]) => ({ meta: categoryMeta(key), cents }))
    .sort((a, b) => b.cents - a.cents);
}
