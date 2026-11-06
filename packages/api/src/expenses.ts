import { insertStatements } from './db/rows.js';
import { changedFields, computeSplit } from '@owewell/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import {
  assertUnlocked,
  assertVersion,
  commitExpenseUpdate,
  nextExpenseVersion,
  findByClientId,
  commitExpenseCreate,
  memberPersonIds,
} from './expenseGuards.js';
import { listExpenses } from './expenseList.js';
export { getBalances } from './balances.js';
import { expenseItems, expenseRevisions, expenseSplits, expenses } from './db/schema.js';

import { planExpenseCreate } from './expenseCreate.js';
import { ExpenseError, type CreateExpenseInput, type ExpenseView } from './expenseContracts.js';
export { ExpenseError } from './expenseContracts.js';
export type { CreateExpenseInput, ExpenseView } from './expenseContracts.js';

export async function createExpense(
  db: DB,
  personId: string,
  groupId: string,
  input: CreateExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  // Return an existing write before validating against membership that may have changed since it landed.
  if (input.clientId) {
    const already = await findByClientId(db, groupId, input.clientId);
    if (already) return already;
  }
  const members = await memberPersonIds(db, groupId);
  if (!members.has(input.payerId))
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  if (input.participants.some((p) => !members.has(p.userId))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Every participant must be a member of the group.');
  }

  const { row, splitRows, view } = planExpenseCreate(personId, groupId, input);
  return commitExpenseCreate(db, groupId, input.clientId, view, [
    db.insert(expenses).values(row),
    ...insertStatements(db, expenseSplits, splitRows),
  ]);
}

/** Replace a simple (non-itemized) expense in place, recomputing its splits. Preserves createdAt. */
export async function updateExpense(
  db: DB,
  personId: string,
  groupId: string,
  expenseId: string,
  input: CreateExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  await assertUnlocked(db, groupId);
  const existing = await db
    .select({
      createdAt: expenses.createdAt,
      description: expenses.description,
      amountCents: expenses.amountCents,
      payerId: expenses.payerId,
      splitMethod: expenses.splitMethod,
      version: expenses.version,
    })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .get();
  if (!existing) throw new ExpenseError('NOT_FOUND', 'That expense no longer exists.');
  assertVersion(existing.version, input.expectedVersion);
  const members = await memberPersonIds(db, groupId);
  if (!members.has(input.payerId))
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  if (input.participants.some((p) => !members.has(p.userId))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Every participant must be a member of the group.');
  }

  let shares;
  try {
    // Same expense, same seed, so an edit never reshuffles who carries the leftover cent.
    shares = computeSplit(input.splitMethod, input.amountCents, input.participants, expenseId);
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }
  const valueByPerson = new Map(input.participants.map((p) => [p.userId, p.value]));

  const changed = changedFields(existing, input);
  const revision =
    changed.length > 0
      ? [
          db.insert(expenseRevisions).values({
            id: crypto.randomUUID(),
            expenseId,
            editedById: personId,
            editedAt: new Date(),
            description: existing.description,
            amountCents: existing.amountCents,
            payerId: existing.payerId,
            splitMethod: existing.splitMethod,
            fields: changed.join(','),
          }),
        ]
      : [];
  await commitExpenseUpdate(db, groupId, expenseId, existing.version, [
    db
      .update(expenses)
      .set({
        payerId: input.payerId,
        description: input.description,
        amountCents: input.amountCents,
        splitMethod: input.splitMethod,
        category: input.category ?? null,
        taxCents: 0,
        tipCents: 0,
        date: input.date ?? null,
        note: input.note ?? null,
        version: nextExpenseVersion(groupId, existing.version),
      })
      .where(eq(expenses.id, expenseId)),
    ...revision,
    db.delete(expenseItems).where(eq(expenseItems.expenseId, expenseId)),
    db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)),
    ...insertStatements(
      db,
      expenseSplits,
      shares.map((s) => ({
        id: crypto.randomUUID(),
        expenseId,
        personId: s.userId,
        owedCents: s.owedCents,
        inputValue: valueByPerson.get(s.userId) ?? null,
      })),
    ),
  ]);
  return {
    id: expenseId,
    description: input.description,
    amountCents: input.amountCents,
    payerId: input.payerId,
    splitMethod: input.splitMethod,
    category: input.category ?? null,
    createdAt: existing.createdAt,
    date: input.date ?? existing.createdAt,
    note: input.note ?? null,
    version: existing.version + 1,
    splits: shares.map((s) => ({ userId: s.userId, owedCents: s.owedCents })),
  };
}

export async function deleteExpense(
  db: DB,
  personId: string,
  groupId: string,
  expenseId: string,
): Promise<void> {
  await requireMembership(db, personId, groupId);
  const e = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .get();
  if (!e) throw new ExpenseError('NOT_FOUND', 'That expense is already gone.');
  await assertUnlocked(db, groupId);
  await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, expenseId));
}

/** Restore the same row and splits to preserve odd-cent allocation. The ledger must be unlocked. */
export async function restoreExpense(
  db: DB,
  personId: string,
  groupId: string,
  expenseId: string,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  const e = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNotNull(expenses.deletedAt)))
    .get();
  if (!e) throw new ExpenseError('NOT_FOUND', 'That expense is not waiting to be restored.');
  await assertUnlocked(db, groupId);
  await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, expenseId));

  // Read it back through the same path the feed uses rather than assembling a view by hand, so an
  // undone itemized receipt comes back with its line items and its correction line intact.
  const restored = (await listExpenses(db, personId, groupId)).find((x) => x.id === expenseId);
  if (!restored) throw new ExpenseError('NOT_FOUND', 'That expense is not waiting to be restored.');
  return restored;
}

/** Net per member from live expenses + settlements; always sums to zero. Members-only. */
