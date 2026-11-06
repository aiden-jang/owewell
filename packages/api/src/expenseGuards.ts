import type { BatchItem } from 'drizzle-orm/batch';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { expenseSplits, expenses, groupMembers, settlements } from './db/schema.js';
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

/** Older clients may omit the expected version. */
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

/** A racing retry hits the unique key, rolls back the whole batch and reads the winner. */
export async function commitExpenseCreate(
  db: DB,
  groupId: string,
  clientId: string | undefined,
  view: ExpenseView,
  writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
): Promise<ExpenseView> {
  try {
    await db.batch(writes);
    return view;
  } catch (error) {
    const saved = clientId && (await findByClientId(db, groupId, clientId));
    if (saved) return saved;
    throw error;
  }
}

export async function memberPersonIds(db: DB, groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: groupMembers.personId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all();
  return new Set(rows.map((r) => r.personId));
}

export function noSettlements(groupId: string) {
  return sql`not exists (select 1 from ${settlements} where ${settlements.groupId} = ${groupId})`;
}

/** Fail the transaction if a competing edit, deletion, or payment won after the read. */
export function nextExpenseVersion(groupId: string, version: number) {
  return sql<number>`case
    when ${expenses.deletedAt} is null and ${expenses.version} = ${version}
      and ${noSettlements(groupId)}
    then ${expenses.version} + 1
    else null end`;
}

export async function commitExpenseUpdate(
  db: DB,
  groupId: string,
  expenseId: string,
  version: number,
  writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
): Promise<void> {
  try {
    await db.batch(writes);
  } catch (error) {
    const current = await db
      .select({ version: expenses.version })
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
      .get();
    if (!current) throw new ExpenseError('NOT_FOUND', 'That expense no longer exists.');
    await assertUnlocked(db, groupId);
    assertVersion(current.version, version);
    throw error;
  }
}
