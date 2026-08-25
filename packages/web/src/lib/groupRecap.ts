import { categoryMeta, type Expense } from '@owewell/core';
import type { Settlement } from './settlements';

export interface GroupRecap {
  totalCents: number;
  largest: { description: string; amountCents: number } | null;
  topCategory: { label: string; emoji: string; amountCents: number } | null;
  daysOpen: number;
}

export function buildGroupRecap(expenses: Expense[], settlements: Settlement[]): GroupRecap {
  const totalCents = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const largest = expenses.reduce<GroupRecap['largest']>(
    (best, expense) =>
      !best || expense.amountCents > best.amountCents
        ? { description: expense.description, amountCents: expense.amountCents }
        : best,
    null,
  );
  const categories = new Map<string, number>();
  for (const expense of expenses) {
    const key = expense.category ?? 'other';
    categories.set(key, (categories.get(key) ?? 0) + expense.amountCents);
  }
  const top = [...categories.entries()].sort((a, b) => b[1] - a[1])[0];
  const meta = top ? categoryMeta(top[0]) : null;
  const moments = [
    ...expenses.map((expense) => new Date(expense.date || expense.createdAt).getTime()),
    ...settlements.map((settlement) => new Date(settlement.createdAt).getTime()),
  ].filter(Number.isFinite);
  const daysOpen =
    moments.length < 2
      ? moments.length
      : Math.max(1, Math.ceil((Math.max(...moments) - Math.min(...moments)) / 86_400_000));

  return {
    totalCents,
    largest,
    topCategory: top && meta ? { label: meta.label, emoji: meta.emoji, amountCents: top[1] } : null,
    daysOpen,
  };
}
