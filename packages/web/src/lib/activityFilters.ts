import { computeItemizedPayers } from '@owewell/shared';
import { categoryMeta, type Expense } from '@owewell/core';

/** Involved: paid or owes a share. Owes: has an unpaid share. Paid: credited as a payer. */
export type Relation = 'involved' | 'owes' | 'paid';

/** The person's owed share of an expense in cents (0 if they aren't a participant). */
export function shareOf(expense: Expense, personId: string): number {
  return expense.splits.find((s) => s.userId === personId)?.owedCents ?? 0;
}

function paidBy(expense: Expense, personId: string): number {
  if (expense.splitMethod !== 'ITEMIZED' || !expense.items?.length) {
    return expense.payerId === personId ? expense.amountCents : 0;
  }
  return (
    computeItemizedPayers({
      items: expense.items.map((item) => ({
        amountCents: item.amountCents,
        payerId: item.payerId ?? expense.payerId,
      })),
      taxCents: expense.taxCents ?? 0,
      tipCents: expense.tipCents ?? 0,
      seed: expense.id,
    }).find((payer) => payer.userId === personId)?.paidCents ?? 0
  );
}

export function matchesPersonLens(expense: Expense, personId: string | null, relation: Relation): boolean {
  if (!personId) return true;
  const share = shareOf(expense, personId);
  const paid = paidBy(expense, personId);
  if (relation === 'paid') return paid > 0;
  if (relation === 'owes') return share > paid;
  return paid > 0 || share > 0;
}

export function lensAmount(expense: Expense, personId: string | null, relation: Relation): number {
  if (!personId || relation === 'involved') return expense.amountCents;
  const paid = paidBy(expense, personId);
  return relation === 'paid' ? paid : Math.max(0, shareOf(expense, personId) - paid);
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
