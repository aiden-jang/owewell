import { computeSplit } from '@owewell/shared';
import { ExpenseError, type CreateExpenseInput, type ExpenseView } from './expenseContracts.js';

export function planExpenseCreate(
  personId: string,
  groupId: string,
  input: CreateExpenseInput,
  roundingBalances?: ReadonlyMap<string, number>,
) {
  const id = crypto.randomUUID();
  let shares;
  try {
    shares = computeSplit(
      input.splitMethod,
      input.amountCents,
      input.participants,
      input.splitSeed ?? id,
      roundingBalances,
    );
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }
  const valueByPerson = new Map(input.participants.map((p) => [p.userId, p.value]));
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const row = {
    id,
    groupId,
    createdById: personId,
    payerId: input.payerId,
    description: input.description,
    amountCents: input.amountCents,
    splitMethod: input.splitMethod,
    category: input.category ?? null,
    date: input.date ?? null,
    note: input.note ?? null,
    clientId: input.clientId ?? null,
    createdAt,
  };
  const splits = shares.map(({ userId, owedCents }) => ({
    userId,
    owedCents,
    inputValue: valueByPerson.get(userId) ?? null,
  }));
  const splitRows = splits.map(({ userId, ...share }) => ({
    id: crypto.randomUUID(),
    expenseId: id,
    personId: userId,
    ...share,
  }));
  const view: ExpenseView = {
    id,
    description: row.description,
    amountCents: row.amountCents,
    payerId: row.payerId,
    splitMethod: row.splitMethod,
    category: row.category,
    date: row.date ?? createdAt,
    createdAt,
    note: row.note,
    version: 1,
    splits,
  };
  return { row, splitRows, view };
}
