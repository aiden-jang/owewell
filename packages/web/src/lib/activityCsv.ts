import { categoryMeta, PAYMENT_METHOD_LABELS } from '@owewell/core';
import type { MoneyFormatter } from '@owewell/shared';
import type { Balance } from './groups';
import type { Expense } from './expenses';
import type { Settlement } from './settlements';

/*
 * The ledger as a spreadsheet.
 *
 * Deliberately ledger-shaped rather than an attempt to recreate the whole UI in a grid: expenses and
 * payments share one sorted timeline, with the current balances tacked on the end. Names are
 * resolved at export time so the file stays readable after somebody changes their display name.
 *
 * Pure, and separate from the download it feeds, because the part worth testing is `csvCell`.
 */

/** Escape one cell, and defuse it. */
export function csvCell(value: string | number): string {
  // Spreadsheet apps execute leading formula characters even inside imported CSV files. User
  // controlled descriptions and names must stay text when the export is opened in Excel/Sheets.
  const raw = String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function activityCsv({
  expenses,
  settlements,
  balances,
  nameOf,
  fmt,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  balances: Balance[];
  nameOf: (userId: string) => string;
  fmt: MoneyFormatter;
}): string {
  const rows = [
    ...expenses.map((expense) => ({
      date: expense.date || expense.createdAt,
      type: 'Expense',
      description: expense.description,
      amount: fmt(expense.amountCents),
      details: `${nameOf(expense.payerId)} paid · ${categoryMeta(expense.category).label}`,
    })),
    ...settlements.map((settlement) => ({
      date: settlement.createdAt,
      type: 'Payment',
      description: `${nameOf(settlement.fromUserId)} → ${nameOf(settlement.toUserId)}`,
      amount: fmt(settlement.amountCents),
      details: settlement.method ? `via ${PAYMENT_METHOD_LABELS[settlement.method]}` : 'payment recorded',
    })),
    ...balances.map((balance) => ({
      date: '',
      type: 'Current balance',
      description: nameOf(balance.userId),
      amount: fmt(Math.abs(balance.netCents)),
      details: balance.netCents > 0 ? 'is owed' : balance.netCents < 0 ? 'owes' : 'settled up',
    })),
  ].sort((a, b) => {
    // Balances are a footer, not events, so they sort to the bottom by name rather than by a date
    // they do not have.
    if (a.type === 'Current balance') return b.type === 'Current balance' ? a.description.localeCompare(b.description) : 1;
    if (b.type === 'Current balance') return -1;
    return a.date.localeCompare(b.date);
  });

  return [
    ['Date', 'Type', 'Description', 'Amount', 'Details'],
    ...rows.map((row) => [
      row.date ? new Date(row.date).toLocaleDateString() : '',
      row.type,
      row.description,
      row.amount,
      row.details,
    ]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

/** Turn a group name into something a filesystem is happy with. */
export function csvFileName(groupName: string): string {
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'owewell'}-activity.csv`;
}
