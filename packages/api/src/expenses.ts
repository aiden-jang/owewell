import { insertStatements } from './db/rows.js';
import { changedFields, computeEditedSplit } from '@owewell/shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
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
  noSettlements,
} from './expenseGuards.js';
import { listExpenses } from './expenseList.js';
export { getBalances } from './balances.js';
import { expenseItems, expenseRevisions, expenseSplits, expenses } from './db/schema.js';

import { planExpenseCreate } from './expenseCreate.js';
import { readEqualRounding, readLedgerVersion } from './equalRounding.js';
import { groupWriteGuard } from './groupWriteGuard.js';
import { ExpenseError, type CreateExpenseInput, type ExpenseView } from './expenseContracts.js';
export { ExpenseError } from './expenseContracts.js';
export type { CreateExpenseInput, ExpenseView } from './expenseContracts.js';

export async function createExpense(
  db: DB,
  personId: string,
  groupId: string,
  input: CreateExpenseInput,
): Promise<ExpenseView> {
  const uneven = input.splitMethod === 'EQUAL' && input.amountCents % input.participants.length > 0;
  for (let attempt = 0; ; attempt++) {
    // Capture the version before reading membership or rounding history.
    const version = uneven ? await readLedgerVersion(db, groupId) : undefined;
    await requireMembership(db, personId, groupId);
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

    const rounding = version === undefined ? undefined : await readEqualRounding(db, groupId);
    const { row, splitRows, view } = planExpenseCreate(personId, groupId, input, rounding);
    const insert = db.insert(expenses).values(row);
    const splitInserts = insertStatements(db, expenseSplits, splitRows);
    try {
      return await commitExpenseCreate(
        db,
        groupId,
        input.clientId,
        view,
        version === undefined
          ? [insert, ...splitInserts]
          : [groupWriteGuard(db, groupId, version), insert, ...splitInserts],
      );
    } catch (error) {
      if (version === undefined || version === (await readLedgerVersion(db, groupId))) throw error;
      if (attempt === 4) throw new ExpenseError('CONFLICT', 'The tab changed while saving. Try again.');
    }
  }
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

  const splits =
    input.splitMethod === 'EQUAL' &&
    existing.splitMethod === 'EQUAL' &&
    input.amountCents % input.participants.length > 0
      ? await db
          .select({ userId: expenseSplits.personId, owedCents: expenseSplits.owedCents })
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, expenseId))
          .all()
      : [];
  let shares;
  try {
    shares = computeEditedSplit(input.splitMethod, input.amountCents, input.participants, {
      id: expenseId,
      splitMethod: existing.splitMethod,
      splits,
    });
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
  expectedVersion?: number,
  clientId?: string,
): Promise<void> {
  await requireMembership(db, personId, groupId);
  const target = and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId));
  const e = await db
    .select({
      version: expenses.version,
      deletedAt: expenses.deletedAt,
      deleteClientId: expenses.deleteClientId,
    })
    .from(expenses)
    .where(target)
    .get();
  if (e?.deletedAt && clientId && e.deleteClientId === clientId) return;
  if (!e || e.deletedAt) throw new ExpenseError('NOT_FOUND', 'That expense is already gone.');
  await assertUnlocked(db, groupId);
  assertVersion(e.version, expectedVersion);
  const deleted = await db
    .update(expenses)
    .set({ deletedAt: new Date(), deleteClientId: clientId ?? null, version: e.version + 1 })
    .where(and(target, isNull(expenses.deletedAt), eq(expenses.version, e.version), noSettlements(groupId)))
    .returning({ id: expenses.id })
    .get();
  if (!deleted) {
    await assertUnlocked(db, groupId);
    throw new ExpenseError('CONFLICT', 'Somebody changed this expense while you were away.');
  }
}

/** Restore the same row and splits to preserve odd-cent allocation. The ledger must be unlocked. */
export async function restoreExpense(
  db: DB,
  personId: string,
  groupId: string,
  expenseId: string,
  clientId?: string,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  const target = and(
    eq(expenses.id, expenseId),
    eq(expenses.groupId, groupId),
    isNotNull(expenses.deletedAt),
    clientId ? eq(expenses.deleteClientId, clientId) : undefined,
  );
  const updated = await db
    .update(expenses)
    .set({ deletedAt: null, deleteClientId: null, version: sql`${expenses.version} + 1` })
    .where(and(target, noSettlements(groupId)))
    .returning({ id: expenses.id })
    .get();
  if (!updated) {
    const deleted = await db.select({ id: expenses.id }).from(expenses).where(target).get();
    if (deleted) await assertUnlocked(db, groupId);
    throw new ExpenseError('NOT_FOUND', 'That expense is not waiting to be restored.');
  }

  // Read it back through the same path the feed uses rather than assembling a view by hand, so an
  // undone itemized receipt comes back with its line items and its correction line intact.
  const restored = (await listExpenses(db, personId, groupId)).find((x) => x.id === expenseId);
  if (!restored) throw new ExpenseError('NOT_FOUND', 'That expense is not waiting to be restored.');
  return restored;
}

/** Net per member from live expenses + settlements; always sums to zero. Members-only. */
