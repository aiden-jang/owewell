import { insertRows } from './db/rows.js';
import { computeItemizedSplit } from '@owewell/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { expenseItemShares, expenseItems, expenseSplits, expenses } from './db/schema.js';
import { requireMembership } from './groups.js';
import {
  assertUnlocked,
  assertVersion,
  clearItemizedRows,
  findByClientId,
  memberPersonIds,
} from './expenseGuards.js';
import { ExpenseError, type CreateItemizedExpenseInput, type ExpenseView } from './expenseContracts.js';

/* A receipt rather than a total: many small amounts, each with its own people and sometimes its
   own payer, plus tax and tip spread across them. Separate from the plain writers because the
   only thing the two share is the guards they both run first. */

export async function createItemizedExpense(
  db: DB,
  personId: string,
  groupId: string,
  input: CreateItemizedExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  // Same replay guard as the simple create. A receipt is the write most likely to be queued offline
  // and the most expensive to duplicate, since it is also the biggest.
  if (input.clientId) {
    const already = await findByClientId(db, groupId, input.clientId);
    if (already) return already;
  }
  const members = await memberPersonIds(db, groupId);
  if (!members.has(input.payerId))
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  const everyone = new Set(input.items.flatMap((i) => i.participantIds));
  if ([...everyone].some((pid) => !members.has(pid))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Everyone on an item must be a group member.');
  }
  if (input.items.some((i) => i.payerId && !members.has(i.payerId))) {
    throw new ExpenseError('INVALID_PAYER', 'An item payer must be a group member.');
  }

  // Before the split, not after, for the same reason as createExpense: the id seeds who absorbs the
  // odd cent, and on a receipt that is one leftover per uneven item plus the tax and tip.
  const id = crypto.randomUUID();

  let shares;
  try {
    shares = computeItemizedSplit({
      items: input.items.map((i) => ({ amountCents: i.amountCents, participantIds: i.participantIds })),
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      seed: id,
    });
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }

  const amountCents =
    input.items.reduce((sum, i) => sum + i.amountCents, 0) + input.taxCents + input.tipCents;
  await db.insert(expenses).values({
    id,
    groupId,
    payerId: input.payerId,
    createdById: personId,
    description: input.description,
    amountCents,
    splitMethod: 'ITEMIZED',
    category: input.category ?? null,
    taxCents: input.taxCents,
    tipCents: input.tipCents,
    date: input.date ?? null,
    note: input.note ?? null,
    clientId: input.clientId ?? null,
  });
  await insertRows(
    db,
    expenseSplits,
    shares.map((s) => ({
      id: crypto.randomUUID(),
      expenseId: id,
      personId: s.userId,
      owedCents: s.owedCents,
    })),
  );
  for (const item of input.items) {
    const itemId = crypto.randomUUID();
    await db.insert(expenseItems).values({
      id: itemId,
      expenseId: id,
      name: item.name,
      amountCents: item.amountCents,
      payerId: item.payerId ?? null,
    });
    await insertRows(
      db,
      expenseItemShares,
      item.participantIds.map((pid) => ({ id: crypto.randomUUID(), itemId, personId: pid })),
    );
  }
  return {
    id,
    description: input.description,
    amountCents,
    payerId: input.payerId,
    splitMethod: 'ITEMIZED',
    category: input.category ?? null,
    createdAt: new Date(),
    date: input.date ?? new Date(),
    note: input.note ?? null,
    version: 1,
    splits: shares.map((s) => ({ userId: s.userId, owedCents: s.owedCents })),
  };
}

/** Replace an itemized expense in place: recompute item splits, swap items + shares. Preserves createdAt. */
export async function updateItemizedExpense(
  db: DB,
  personId: string,
  groupId: string,
  expenseId: string,
  input: CreateItemizedExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  await assertUnlocked(db, groupId);
  const existing = await db
    .select({ createdAt: expenses.createdAt, version: expenses.version })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .get();
  if (!existing) throw new ExpenseError('NOT_FOUND', 'That expense no longer exists.');
  assertVersion(existing.version, input.expectedVersion);
  const members = await memberPersonIds(db, groupId);
  if (!members.has(input.payerId))
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  const everyone = new Set(input.items.flatMap((i) => i.participantIds));
  if ([...everyone].some((pid) => !members.has(pid))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Everyone on an item must be a group member.');
  }
  if (input.items.some((i) => i.payerId && !members.has(i.payerId))) {
    throw new ExpenseError('INVALID_PAYER', 'An item payer must be a group member.');
  }

  let shares;
  try {
    shares = computeItemizedSplit({
      items: input.items.map((i) => ({ amountCents: i.amountCents, participantIds: i.participantIds })),
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      seed: expenseId,
    });
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }
  const amountCents =
    input.items.reduce((sum, i) => sum + i.amountCents, 0) + input.taxCents + input.tipCents;

  await db
    .update(expenses)
    .set({
      payerId: input.payerId,
      description: input.description,
      amountCents,
      splitMethod: 'ITEMIZED',
      category: input.category ?? null,
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      date: input.date ?? null,
      note: input.note ?? null,
      version: existing.version + 1,
    })
    .where(eq(expenses.id, expenseId));
  await clearItemizedRows(db, expenseId);
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  await insertRows(
    db,
    expenseSplits,
    shares.map((s) => ({ id: crypto.randomUUID(), expenseId, personId: s.userId, owedCents: s.owedCents })),
  );
  for (const item of input.items) {
    const itemId = crypto.randomUUID();
    await db.insert(expenseItems).values({
      id: itemId,
      expenseId,
      name: item.name,
      amountCents: item.amountCents,
      payerId: item.payerId ?? null,
    });
    await insertRows(
      db,
      expenseItemShares,
      item.participantIds.map((pid) => ({ id: crypto.randomUUID(), itemId, personId: pid })),
    );
  }
  return {
    id: expenseId,
    description: input.description,
    amountCents,
    payerId: input.payerId,
    splitMethod: 'ITEMIZED',
    category: input.category ?? null,
    createdAt: existing.createdAt,
    date: input.date ?? existing.createdAt,
    note: input.note ?? null,
    version: existing.version + 1,
    splits: shares.map((s) => ({ userId: s.userId, owedCents: s.owedCents })),
  };
}
