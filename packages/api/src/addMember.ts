import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { computeItemizedSplit, computeSplit } from '@owewell/shared';
import type { DB } from './db/client.js';
import { inIds } from './db/ids.js';
import { insertStatements } from './db/rows.js';
import {
  expenseItems,
  expenseItemShares,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  people,
  settlements,
} from './db/schema.js';
import { GroupError, memberView, requireMembership, type GroupMemberView } from './groups.js';
import { groupWriteGuard } from './groupWriteGuard.js';

function replaceSplits(db: DB, expenseId: string, shares: { userId: string; owedCents: number }[]) {
  return [
    db
      .update(expenses)
      .set({ version: sql`${expenses.version} + 1` })
      .where(eq(expenses.id, expenseId)),
    db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)),
    ...insertStatements(
      db,
      expenseSplits,
      shares.map(({ userId, owedCents }) => ({
        id: crypto.randomUUID(),
        expenseId,
        personId: userId,
        owedCents,
      })),
    ),
  ];
}

const sameSet = (ids: string[], set: Set<string>): boolean =>
  ids.length === set.size && ids.every((id) => set.has(id));

/** Internal: the roster changed, so everybody's share of the shared expenses did too. */
async function planSharedSplits(
  db: DB,
  groupId: string,
  priorMemberIds: string[],
  newMemberId: string,
): Promise<BatchItem<'sqlite'>[]> {
  const writes: BatchItem<'sqlite'>[] = [];
  if (priorMemberIds.length === 0) return writes;
  const priorSet = new Set(priorMemberIds);
  const everyone = [...priorMemberIds, newMemberId];

  const rows = await db
    .select({
      id: expenses.id,
      amountCents: expenses.amountCents,
      splitMethod: expenses.splitMethod,
      taxCents: expenses.taxCents,
      tipCents: expenses.tipCents,
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .all();

  for (const e of rows) {
    if (e.splitMethod === 'EQUAL') {
      const parts = (
        await db
          .select({ personId: expenseSplits.personId })
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, e.id))
          .all()
      ).map((r) => r.personId);
      if (!sameSet(parts, priorSet)) continue; // subset splits stay as-is
      writes.push(
        ...replaceSplits(
          db,
          e.id,
          computeSplit(
            'EQUAL',
            e.amountCents,
            everyone.map((userId) => ({ userId })),
            e.id,
          ),
        ),
      );
    } else if (e.splitMethod === 'ITEMIZED') {
      const itemRows = await db
        .select({ id: expenseItems.id, amountCents: expenseItems.amountCents })
        .from(expenseItems)
        .where(eq(expenseItems.expenseId, e.id))
        .all();
      const shareRows = await db
        .select({ itemId: expenseItemShares.itemId, personId: expenseItemShares.personId })
        .from(expenseItemShares)
        .where(
          inIds(
            expenseItemShares.itemId,
            itemRows.map((i) => i.id),
          ),
        )
        .all();
      const partsByItem = new Map<string, string[]>();
      for (const s of shareRows)
        partsByItem.set(s.itemId, [...(partsByItem.get(s.itemId) ?? []), s.personId]);
      // Only receipts where *every* item was shared by everyone.
      if (!itemRows.every((i) => sameSet(partsByItem.get(i.id) ?? [], priorSet))) continue;
      writes.push(
        ...insertStatements(
          db,
          expenseItemShares,
          itemRows.map((item) => ({
            id: crypto.randomUUID(),
            itemId: item.id,
            personId: newMemberId,
          })),
        ),
      );
      const shares = computeItemizedSplit({
        items: itemRows.map((i) => ({ amountCents: i.amountCents, participantIds: everyone })),
        taxCents: e.taxCents,
        tipCents: e.tipCents,
        seed: e.id,
      });
      writes.push(...replaceSplits(db, e.id, shares));
    }
  }
  return writes;
}

export async function addPlaceholderMember(
  db: DB,
  personId: string,
  groupId: string,
  name: string,
  clientId?: string,
): Promise<GroupMemberView> {
  await requireMembership(db, personId, groupId);
  const findGroup = () =>
    db.select({ version: groups.ledgerVersion }).from(groups).where(eq(groups.id, groupId)).get();
  const findAttempt = () =>
    clientId
      ? db
          .select({ personId: groupMembers.personId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.addClientId, clientId)))
          .get()
      : undefined;
  const group = await findGroup();
  if (!group) throw new GroupError('NOT_FOUND', 'Group not found.');
  const previous = await findAttempt();
  if (previous) return memberView(db, groupId, previous.personId);
  const [paid, members] = await Promise.all([
    db.select({ id: settlements.id }).from(settlements).where(eq(settlements.groupId, groupId)).get(),
    db
      .select({ id: groupMembers.personId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .all(),
  ]);
  const newPersonId = crypto.randomUUID();
  const joinedAt = new Date();
  const splits = paid
    ? []
    : await planSharedSplits(
        db,
        groupId,
        members.map(({ id }) => id),
        newPersonId,
      );
  try {
    await db.batch([
      groupWriteGuard(db, groupId, group.version),
      db.insert(people).values({ id: newPersonId, displayName: name, isPlaceholder: true }),
      db.insert(groupMembers).values({
        id: crypto.randomUUID(),
        groupId,
        personId: newPersonId,
        role: 'MEMBER',
        joinedAt,
        addClientId: clientId ?? null,
      }),
      ...splits,
    ]);
  } catch (error) {
    const retry = await findAttempt();
    if (retry) return memberView(db, groupId, retry.personId);
    const latest = await findGroup();
    if (!latest) throw new GroupError('NOT_FOUND', 'Group not found.');
    if (latest.version !== group.version)
      throw new GroupError('LEDGER_CHANGED', 'The group changed. Try adding the member again.');
    throw error;
  }
  return memberView(db, groupId, newPersonId);
}
