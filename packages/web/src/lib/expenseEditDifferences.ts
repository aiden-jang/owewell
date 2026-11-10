import { categoryMeta, type Expense, type ExpenseItemInput } from '@owewell/core';
import { computeEditedSplit, computeItemizedSplit, formatMoney } from '@owewell/shared';
import type { QueuedEdit } from './outbox';
import { SPLIT_METHODS } from './splitMethods';

type NameOf = (id: string) => string;

export interface ExpenseEditDifference {
  label: string;
  ledger: string;
  edit: string;
}

type Difference = (nameOf: NameOf) => ExpenseEditDifference;

function splitLabel(method: Expense['splitMethod']) {
  return method === 'ITEMIZED'
    ? 'Itemized receipt'
    : (SPLIT_METHODS.find(({ value }) => value === method)?.label ?? method);
}

function lineItem(item: ExpenseItemInput | undefined, payerId: string) {
  return (
    item && {
      name: item.name.trim(),
      amountCents: item.amountCents,
      payerId: item.payerId ?? payerId,
      participantIds: [...item.participantIds].sort(),
    }
  );
}

function describeItem(item: ReturnType<typeof lineItem>, nameOf: NameOf) {
  if (!item) return 'Not included';
  const people = item.participantIds.map(nameOf).join(', ');
  return `${item.name} · ${formatMoney(item.amountCents)}. Paid by ${nameOf(item.payerId)}. Shared by ${people}.`;
}

function share(owedCents: number, inputValue: number | null, method: Expense['splitMethod']) {
  return {
    owedCents,
    allocation:
      inputValue !== null && (method === 'PERCENT' || method === 'SHARES')
        ? { method, value: inputValue }
        : null,
  };
}

function describeShare(value?: ReturnType<typeof share>) {
  if (!value) return 'Not included';
  const { owedCents, allocation } = value;
  const amount = formatMoney(owedCents);
  if (!allocation) return amount;
  return allocation.method === 'PERCENT'
    ? `${amount} (${allocation.value / 100}%)`
    : `${amount} (shares: ${allocation.value})`;
}

/** Compare the fields an edit replaces using the same rounding rules as the ledger. */
export function expenseEditDifferences(entry: QueuedEdit, expense: Expense): Difference[] | null {
  try {
    const payload = entry.payload;
    const receipt = 'items' in payload;
    if (receipt !== (entry.kind === 'edit-itemized')) return null;
    const method = receipt ? 'ITEMIZED' : payload.splitMethod;
    const shares = receipt
      ? computeItemizedSplit({ ...payload, seed: expense.id })
      : computeEditedSplit(payload.splitMethod, payload.amountCents, payload.participants, expense);
    const amountCents = receipt
      ? payload.items.reduce((total, item) => total + item.amountCents, payload.taxCents + payload.tipCents)
      : payload.amountCents;
    const inputs = new Map(
      receipt ? [] : payload.participants.map((person) => [person.userId, person.value]),
    );
    const differences: Difference[] = [];
    const add = <T>(
      label: string | ((nameOf: NameOf) => string),
      before: T,
      after: T,
      format: (value: T, nameOf: NameOf) => string,
    ) => {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      differences.push((nameOf) => ({
        label: typeof label === 'string' ? label : label(nameOf),
        ledger: format(before, nameOf),
        edit: format(after, nameOf),
      }));
    };

    add('Description', expense.description, payload.description.trim(), String);
    add('Total', expense.amountCents, amountCents, formatMoney);
    add('Paid by', expense.payerId, payload.payerId, (id, nameOf) => nameOf(id));
    add('Split method', expense.splitMethod, method, splitLabel);
    add('Date', expense.date.slice(0, 10), payload.date ?? expense.createdAt.slice(0, 10), String);
    add('Category', categoryMeta(expense.category).label, categoryMeta(payload.category).label, String);
    add('Note', expense.note ?? '', payload.note?.trim() ?? '', (note) => note || 'None');

    const before = new Map(
      expense.splits.map((person) => [
        person.userId,
        share(person.owedCents, person.inputValue ?? null, expense.splitMethod),
      ]),
    );
    const after = new Map(
      shares.map((person) => [
        person.userId,
        share(person.owedCents, inputs.get(person.userId) ?? null, method),
      ]),
    );
    for (const person of new Set([...before.keys(), ...after.keys()])) {
      add((nameOf) => `${nameOf(person)}’s share`, before.get(person), after.get(person), describeShare);
    }

    const savedItems = expense.items ?? [];
    const editedItems = receipt ? payload.items : [];
    add('Tax', expense.taxCents ?? 0, receipt ? payload.taxCents : 0, formatMoney);
    add('Tip', expense.tipCents ?? 0, receipt ? payload.tipCents : 0, formatMoney);
    for (let i = 0; i < Math.max(savedItems.length, editedItems.length); i++) {
      add(
        `Receipt item ${i + 1}`,
        lineItem(savedItems[i], expense.payerId),
        lineItem(editedItems[i], payload.payerId),
        describeItem,
      );
    }
    return differences;
  } catch {
    // Older or invalid queued payloads still need review. Do not infer that they were applied.
    return null;
  }
}
