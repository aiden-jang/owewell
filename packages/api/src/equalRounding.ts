import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { expenses, expenseSplits, groups } from './db/schema.js';

export async function readLedgerVersion(db: DB, groupId: string) {
  const group = await db
    .select({ version: groups.ledgerVersion })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();
  return group?.version;
}

/** Sum the difference between each saved share and its ideal equal share, in fractional cents. */
export async function readEqualRounding(db: DB, groupId: string) {
  const bills = db.$with('equal_bills').as(
    // Removing a member can leave proportional shares on an expense marked EQUAL.
    db
      .select({
        id: expenses.id,
        amount: expenses.amountCents,
        size: count().as('participant_count'),
      })
      .from(expenses)
      .innerJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
      .where(
        and(eq(expenses.groupId, groupId), eq(expenses.splitMethod, 'EQUAL'), isNull(expenses.deletedAt)),
      )
      .groupBy(expenses.id).having(sql`${expenses.amountCents} % count(*) <> 0
        and min(${expenseSplits.owedCents}) = ${expenses.amountCents} / count(*)
        and max(${expenseSplits.owedCents}) = ${expenses.amountCents} / count(*) + 1`),
  );

  const rows = await db
    .with(bills)
    .select({
      userId: expenseSplits.personId,
      // Subtract whole cents before using division with a fractional result.
      balance: sql<number>`round(sum(
        ${expenseSplits.owedCents} - ${bills.amount} / ${bills.size}
        - 1.0 * (${bills.amount} % ${bills.size}) / ${bills.size}
      ), 9)`,
    })
    .from(bills)
    .innerJoin(expenseSplits, eq(expenseSplits.expenseId, bills.id))
    .groupBy(expenseSplits.personId)
    .all();
  return new Map(rows.map(({ userId, balance }) => [userId, balance]));
}
