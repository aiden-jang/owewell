import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { expenseItemShares, expenseItems, expenseRevisions, expenseSplits, expenses } from './db/schema.js';
import { requireMembership } from './groups.js';
import type { ExpenseView } from './expenses.js';

/* Reading the tab. Separate from the writers because it shares nothing with them but the row
   shape: no guards, no version checks, no idempotency, just the query that assembles a view. */

export async function listExpenses(db: DB, personId: string, groupId: string): Promise<ExpenseView[]> {
  await requireMembership(db, personId, groupId);
  const rows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.createdAt))
    .all();
  if (rows.length === 0) return [];
  const splitRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      userId: expenseSplits.personId,
      owedCents: expenseSplits.owedCents,
      inputValue: expenseSplits.inputValue,
    })
    .from(expenseSplits)
    .where(
      inArray(
        expenseSplits.expenseId,
        rows.map((r) => r.id),
      ),
    )
    .all();
  const byExpense = new Map<string, { userId: string; owedCents: number; inputValue: number | null }[]>();
  for (const s of splitRows) {
    const list = byExpense.get(s.expenseId) ?? [];
    list.push({ userId: s.userId, owedCents: s.owedCents, inputValue: s.inputValue });
    byExpense.set(s.expenseId, list);
  }

  /*
   * The latest correction per expense, in one query. Only the newest: the feed answers "has this
   * changed, and from what", not "give me a changelog in the middle of a list of dinners".
   */
  const editByExpense = new Map<
    string,
    { at: Date; byId: string; fields: string[]; formerAmountCents: number }
  >();
  const revisionRows = await db
    .select()
    .from(expenseRevisions)
    .where(
      inArray(
        expenseRevisions.expenseId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(expenseRevisions.editedAt))
    .all();
  for (const revision of revisionRows) {
    // Sorted newest first, so the first one seen for an expense is the one to keep.
    if (editByExpense.has(revision.expenseId)) continue;
    editByExpense.set(revision.expenseId, {
      at: revision.editedAt,
      byId: revision.editedById,
      fields: revision.fields.split(','),
      formerAmountCents: revision.amountCents,
    });
  }

  // For itemized expenses, attach line items + their participants so the edit form can prefill.
  const itemsByExpense = new Map<
    string,
    { name: string; amountCents: number; participantIds: string[]; payerId?: string }[]
  >();
  const itemizedIds = rows.filter((r) => r.splitMethod === 'ITEMIZED').map((r) => r.id);
  if (itemizedIds.length > 0) {
    const itemRows = await db
      .select({
        id: expenseItems.id,
        expenseId: expenseItems.expenseId,
        name: expenseItems.name,
        amountCents: expenseItems.amountCents,
        payerId: expenseItems.payerId,
      })
      .from(expenseItems)
      .where(inArray(expenseItems.expenseId, itemizedIds))
      .all();
    const sharesByItem = new Map<string, string[]>();
    if (itemRows.length > 0) {
      const shareRows = await db
        .select({ itemId: expenseItemShares.itemId, personId: expenseItemShares.personId })
        .from(expenseItemShares)
        .where(
          inArray(
            expenseItemShares.itemId,
            itemRows.map((i) => i.id),
          ),
        )
        .all();
      for (const s of shareRows) {
        const l = sharesByItem.get(s.itemId) ?? [];
        l.push(s.personId);
        sharesByItem.set(s.itemId, l);
      }
    }
    for (const it of itemRows) {
      const l = itemsByExpense.get(it.expenseId) ?? [];
      l.push({
        name: it.name,
        amountCents: it.amountCents,
        participantIds: sharesByItem.get(it.id) ?? [],
        ...(it.payerId ? { payerId: it.payerId } : {}),
      });
      itemsByExpense.set(it.expenseId, l);
    }
  }

  return rows.map((e) => ({
    id: e.id,
    description: e.description,
    amountCents: e.amountCents,
    payerId: e.payerId,
    splitMethod: e.splitMethod,
    category: e.category,
    createdAt: e.createdAt,
    date: e.date ?? e.createdAt,
    note: e.note,
    version: e.version,
    splits: byExpense.get(e.id) ?? [],
    ...(editByExpense.has(e.id) ? { lastEdit: editByExpense.get(e.id)! } : {}),
    ...(e.splitMethod === 'ITEMIZED'
      ? { taxCents: e.taxCents, tipCents: e.tipCents, items: itemsByExpense.get(e.id) ?? [] }
      : {}),
  }));
}
