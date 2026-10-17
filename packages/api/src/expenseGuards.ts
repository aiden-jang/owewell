import { inIds } from './db/ids.js';
import { and, count, eq } from 'drizzle-orm';
import type { DB } from './db/client.js';
import {
  expenseItemShares,
  expenseItems,
  expenseSplits,
  expenses,
  groupMembers,
  settlements,
} from './db/schema.js';
import { ExpenseError, type ExpenseView } from './expenseContracts.js';

/* The checks every expense write makes before it touches a row, and the teardown one of them
   needs. Shared by the plain and the itemized paths, which is why they are not in either. */

/**
 * Once any payment is recorded, changing or removing an expense would break the settlement
 * that was logged against the old balances — so the ledger locks. Throws LOCKED if the group
 * has any settlement. (Mirrors the member-removal rule.)
 */
export async function assertUnlocked(db: DB, groupId: string): Promise<void> {
  const settled = await db
    .select({ c: count() })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .get();
  if ((settled?.c ?? 0) > 0) {
    throw new ExpenseError('LOCKED', "Can't change or delete an expense once a payment has been recorded.");
  }
}

/** An omitted expected version explicitly permits overwriting after conflict confirmation. */
export function assertVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new ExpenseError('CONFLICT', 'Somebody changed this expense while you were away.');
  }
}

/** The expense this client id already produced, if any. Null when this is a first attempt. */
export async function findByClientId(db: DB, groupId: string, clientId: string): Promise<ExpenseView | null> {
  const row = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), eq(expenses.clientId, clientId)))
    .get();
  if (!row) return null;
  // Deleted counts as landed: replaying a create for something the user then deleted must not bring
  // it back, so this looks past `deletedAt` deliberately and the caller gets the row as it stands.
  const all = await db.select().from(expenses).where(eq(expenses.id, row.id)).get();
  if (!all) return null;
  return {
    id: all.id,
    description: all.description,
    amountCents: all.amountCents,
    payerId: all.payerId,
    splitMethod: all.splitMethod,
    category: all.category,
    createdAt: all.createdAt,
    date: all.date ?? all.createdAt,
    note: all.note,
    version: all.version,
    splits: (
      await db
        .select({
          userId: expenseSplits.personId,
          owedCents: expenseSplits.owedCents,
          inputValue: expenseSplits.inputValue,
        })
        .from(expenseSplits)
        .where(eq(expenseSplits.expenseId, all.id))
        .all()
    ).map((sp) => ({ userId: sp.userId, owedCents: sp.owedCents, inputValue: sp.inputValue })),
  };
}

export async function memberPersonIds(db: DB, groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: groupMembers.personId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all();
  return new Set(rows.map((r) => r.personId));
}

/** Drop an expense's line items + their per-item shares (used when replacing on edit). */
export async function clearItemizedRows(db: DB, expenseId: string): Promise<void> {
  const itemRows = await db
    .select({ id: expenseItems.id })
    .from(expenseItems)
    .where(eq(expenseItems.expenseId, expenseId))
    .all();
  if (itemRows.length === 0) return;
  await db.delete(expenseItemShares).where(
    inIds(
      expenseItemShares.itemId,
      itemRows.map((r) => r.id),
    ),
  );
  await db.delete(expenseItems).where(eq(expenseItems.expenseId, expenseId));
}
