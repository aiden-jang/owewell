import {
  changedFields,
  computeItemizedSplit,
  computeItemizedPayers,
  computeSplit,
  type SplitMethod,
} from '@owewell/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import {
  expenseItemShares,
  expenseItems,
  expenseRevisions,
  expenseSplits,
  expenses,
  groupMembers,
  people,
  settlements,
} from './db/schema.js';

export type ExpenseErrorCode =
  'INVALID_PAYER' | 'INVALID_PARTICIPANT' | 'INVALID_SPLIT' | 'NOT_FOUND' | 'LOCKED' | 'CONFLICT';

export class ExpenseError extends Error {
  constructor(
    readonly code: ExpenseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export interface CreateExpenseInput {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  participants: { userId: string; value?: number }[];
  /** Spend category key. Omit to default to "other". */
  category?: string | undefined;
  /** Optional free text: why this cost what it did. Omit or null to clear. */
  note?: string | null | undefined;
  /**
   * Client-chosen id, so a create that is retried after a dropped connection is recognised rather
   * than duplicated. Omit for writes that cannot be replayed.
   */
  clientId?: string | undefined;
  /**
   * The version this edit was written against. Omit to overwrite whatever is there now, which is
   * what "apply mine anyway" does after a conflict has been shown to a person.
   */
  expectedVersion?: number | undefined;
  /** The date the expense happened (backdatable). Omit to use "now". */
  date?: Date;
  /**
   * Overrides the odd-cent tie-break seed, which normally comes from the expense id.
   *
   * Only for callers that must show the split before it exists. Quick split previews exact
   * per-person cents in the browser, and it cannot predict a server-side randomUUID — so on an
   * uneven bill the number shown was often not the number saved.
   */
  splitSeed?: string;
}

export interface CreateItemizedExpenseInput {
  description: string;
  payerId: string;
  taxCents: number;
  tipCents: number;
  items: { name: string; amountCents: number; participantIds: string[]; payerId?: string | undefined }[];
  category?: string | undefined;
  /** Optional free text: why this cost what it did. Omit or null to clear. */
  note?: string | null | undefined;
  /** Client-chosen id, so a retried create is recognised rather than duplicated. */
  clientId?: string | undefined;
  /** The version this edit was written against. Omit to overwrite unconditionally. */
  expectedVersion?: number | undefined;
  date?: Date;
}

export interface ExpenseView {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: string;
  category: string | null;
  createdAt: Date;
  /** The effective expense date (user-set date, else createdAt). Drives feed order + display. */
  date: Date;
  /** Optional free text from whoever entered it. Null when they didn't write one. */
  note: string | null;
  /** Bumped on every edit. Hand it back on an edit to be told when the row has moved on. */
  version: number;
  splits: { userId: string; owedCents: number; inputValue?: number | null }[];
  // Present only for ITEMIZED expenses, so the edit form can prefill the receipt.
  taxCents?: number;
  tipCents?: number;
  items?: { name: string; amountCents: number; participantIds: string[] }[];
  /** The most recent correction, when there has been one. Older ones stay in the table, unread. */
  lastEdit?: { at: Date; byId: string; fields: string[]; formerAmountCents: number };
}

export interface MemberBalance {
  userId: string;
  displayName: string;
  /** True when they hold no seat but still have money in the group. See computeBalances. */
  former?: boolean;
  netCents: number;
  /** What they paid on bills (excludes settlements). */
  paidCents: number;
  /** Their share of the bills (excludes settlements). */
  owedCents: number;
}

/**
 * Once any payment is recorded, changing or removing an expense would break the settlement
 * that was logged against the old balances — so the ledger locks. Throws LOCKED if the group
 * has any settlement. (Mirrors the member-removal rule.)
 */
async function assertUnlocked(db: DB, groupId: string): Promise<void> {
  const settled = await db
    .select({ c: count() })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .get();
  if ((settled?.c ?? 0) > 0) {
    throw new ExpenseError('LOCKED', "Can't change or delete an expense once a payment has been recorded.");
  }
}

/**
 * Refuse an edit written against a version that has since moved.
 *
 * Only when the caller names a version. Omitting it means "apply mine regardless", which is what the
 * client sends once a person has been shown the conflict and chosen — otherwise the second attempt
 * conflicts with the change the first was told about, forever.
 */
function assertVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new ExpenseError('CONFLICT', 'Somebody changed this expense while you were away.');
  }
}

/** The expense this client id already produced, if any. Null when this is a first attempt. */
async function findByClientId(db: DB, groupId: string, clientId: string): Promise<ExpenseView | null> {
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

async function memberPersonIds(db: DB, groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ personId: groupMembers.personId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all();
  return new Set(rows.map((r) => r.personId));
}

/** Drop an expense's line items + their per-item shares (used when replacing on edit). */
async function clearItemizedRows(db: DB, expenseId: string): Promise<void> {
  const itemRows = await db
    .select({ id: expenseItems.id })
    .from(expenseItems)
    .where(eq(expenseItems.expenseId, expenseId))
    .all();
  if (itemRows.length === 0) return;
  await db.delete(expenseItemShares).where(
    inArray(
      expenseItemShares.itemId,
      itemRows.map((r) => r.id),
    ),
  );
  await db.delete(expenseItems).where(eq(expenseItems.expenseId, expenseId));
}

export async function createExpense(
  db: DB,
  personId: string,
  groupId: string,
  input: CreateExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(db, personId, groupId);
  /*
   * A retry of a write that already landed returns what landed. A request that times out mid-flight
   * looks, from the client, identical to one that never arrived — without this, "send it again" is
   * how a $180 dinner shows up twice.
   *
   * Checked before validation on purpose: re-validating a replay against a group that has since
   * changed would reject a retry of something already in the ledger.
   */
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

  // Generated before the split, not after: the id seeds which participant absorbs the odd cent on an
  // uneven bill. Seeded per expense, the leftover moves around instead of always landing on whoever is
  // listed first (in practice the owner).
  const id = crypto.randomUUID();

  let shares;
  try {
    shares = computeSplit(input.splitMethod, input.amountCents, input.participants, input.splitSeed ?? id);
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }
  const valueByPerson = new Map(input.participants.map((p) => [p.userId, p.value]));
  await db.insert(expenses).values({
    id,
    groupId,
    payerId: input.payerId,
    createdById: personId,
    description: input.description,
    amountCents: input.amountCents,
    splitMethod: input.splitMethod,
    category: input.category ?? null,
    date: input.date ?? null,
    note: input.note ?? null,
    clientId: input.clientId ?? null,
  });
  await db.insert(expenseSplits).values(
    shares.map((s) => ({
      id: crypto.randomUUID(),
      expenseId: id,
      personId: s.userId,
      owedCents: s.owedCents,
      inputValue: valueByPerson.get(s.userId) ?? null,
    })),
  );
  return {
    id,
    description: input.description,
    amountCents: input.amountCents,
    payerId: input.payerId,
    splitMethod: input.splitMethod,
    category: input.category ?? null,
    createdAt: new Date(),
    date: input.date ?? new Date(),
    note: input.note ?? null,
    version: 1,
    splits: shares.map((s) => ({ userId: s.userId, owedCents: s.owedCents })),
  };
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

  await db
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
      version: existing.version + 1,
    })
    .where(eq(expenses.id, expenseId));
  /*
   * Record what it said before, written after the update so a failed edit leaves no revision for a
   * change that never happened. Only when something moved: re-saving an untouched form is not a
   * correction, and a row for it would bury the ones that matter.
   */
  const changed = changedFields(existing, {
    description: input.description,
    amountCents: input.amountCents,
    payerId: input.payerId,
    splitMethod: input.splitMethod,
  });
  if (changed.length > 0) {
    await db.insert(expenseRevisions).values({
      id: crypto.randomUUID(),
      expenseId,
      editedById: personId,
      editedAt: new Date(),
      description: existing.description,
      amountCents: existing.amountCents,
      payerId: existing.payerId,
      splitMethod: existing.splitMethod,
      fields: changed.join(','),
    });
  }

  await clearItemizedRows(db, expenseId); // in case it used to be itemized
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  await db.insert(expenseSplits).values(
    shares.map((s) => ({
      id: crypto.randomUUID(),
      expenseId,
      personId: s.userId,
      owedCents: s.owedCents,
      inputValue: valueByPerson.get(s.userId) ?? null,
    })),
  );
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
  await db.insert(expenseSplits).values(
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
    await db
      .insert(expenseItemShares)
      .values(item.participantIds.map((pid) => ({ id: crypto.randomUUID(), itemId, personId: pid })));
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
  await db
    .insert(expenseSplits)
    .values(
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
    await db
      .insert(expenseItemShares)
      .values(item.participantIds.map((pid) => ({ id: crypto.randomUUID(), itemId, personId: pid })));
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

/**
 * Put back an expense that was just deleted.
 *
 * Deletion is a soft delete, so undo is a flag flip: same row, same splits, same odd-cent
 * assignment. A re-create would quietly move a penny between two people.
 *
 * Not time-limited on the server. The toast that offers it is, but a rule enforced only by how long
 * a message stays on screen is not a rule — and the ledger has to be unlocked either way, so nobody
 * has settled against the balances in between.
 */
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
export async function getBalances(db: DB, personId: string, groupId: string): Promise<MemberBalance[]> {
  await requireMembership(db, personId, groupId);
  return computeBalances(db, groupId);
}

/** The balance math with no access check. Callers (getBalances, the public share summary) are
 *  responsible for deciding who may see it. */
export async function computeBalances(db: DB, groupId: string): Promise<MemberBalance[]> {
  const members = await db
    .select({
      personId: groupMembers.personId,
      displayName: people.displayName,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(groupMembers.joinedAt)
    .all();
  const net = new Map<string, number>(members.map((m) => [m.personId, 0]));
  const bump = (p: string, d: number): void => {
    net.set(p, (net.get(p) ?? 0) + d);
  };
  // Track the raw bill figures behind the net, so the UI can show "paid X, share Y" and not
  // just the verdict. `paid` is what they covered on expenses; `owed` is their share of the
  // bills. Settlements move the net around but aren't spending, so they don't touch these.
  const paid = new Map<string, number>(members.map((m) => [m.personId, 0]));
  const owed = new Map<string, number>(members.map((m) => [m.personId, 0]));
  const add = (map: Map<string, number>, p: string, d: number): void => {
    map.set(p, (map.get(p) ?? 0) + d);
  };

  const exps = await db
    .select({
      id: expenses.id,
      payerId: expenses.payerId,
      amountCents: expenses.amountCents,
      splitMethod: expenses.splitMethod,
      taxCents: expenses.taxCents,
      tipCents: expenses.tipCents,
    })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .all();

  // Credit side. Non-itemized expenses credit their single payer the full amount.
  // Itemized expenses credit each line item's payer (falling back to the expense
  // payer for items with no per-item payer), plus a proportional share of tax + tip.
  const itemizedIds = exps.filter((e) => e.splitMethod === 'ITEMIZED').map((e) => e.id);
  const itemsByExpense = new Map<string, { amountCents: number; payerId: string | null }[]>();
  if (itemizedIds.length) {
    const itemRows = await db
      .select({
        expenseId: expenseItems.expenseId,
        amountCents: expenseItems.amountCents,
        payerId: expenseItems.payerId,
      })
      .from(expenseItems)
      .where(inArray(expenseItems.expenseId, itemizedIds))
      .all();
    for (const it of itemRows) {
      const arr = itemsByExpense.get(it.expenseId) ?? [];
      arr.push({ amountCents: it.amountCents, payerId: it.payerId });
      itemsByExpense.set(it.expenseId, arr);
    }
  }
  for (const e of exps) {
    const items = e.splitMethod === 'ITEMIZED' ? itemsByExpense.get(e.id) : undefined;
    if (items && items.length > 0) {
      const payers = computeItemizedPayers({
        items: items.map((it) => ({ amountCents: it.amountCents, payerId: it.payerId ?? e.payerId })),
        taxCents: e.taxCents,
        tipCents: e.tipCents,
        seed: e.id,
      });
      for (const p of payers) {
        bump(p.userId, p.paidCents);
        add(paid, p.userId, p.paidCents);
      }
    } else {
      bump(e.payerId, e.amountCents);
      add(paid, e.payerId, e.amountCents);
    }
  }
  if (exps.length) {
    const splitRows = await db
      .select({ personId: expenseSplits.personId, owedCents: expenseSplits.owedCents })
      .from(expenseSplits)
      .where(
        inArray(
          expenseSplits.expenseId,
          exps.map((e) => e.id),
        ),
      )
      .all();
    for (const s of splitRows) {
      bump(s.personId, -s.owedCents);
      add(owed, s.personId, s.owedCents);
    }
  }

  const setl = await db
    .select({
      fromPersonId: settlements.fromPersonId,
      toPersonId: settlements.toPersonId,
      amountCents: settlements.amountCents,
    })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .all();
  for (const s of setl) {
    bump(s.fromPersonId, s.amountCents);
    bump(s.toPersonId, -s.amountCents);
  }

  const rows: MemberBalance[] = members.map((m) => ({
    userId: m.personId,
    displayName: m.displayName,
    netCents: net.get(m.personId) ?? 0,
    paidCents: paid.get(m.personId) ?? 0,
    owedCents: owed.get(m.personId) ?? 0,
  }));

  // Anyone `bump` touched who no longer holds a seat.
  //
  // Returning `members.map(...)` instead drops them: their balance is computed and discarded, the
  // rest stop netting to zero, simplifyDebts refuses, and every balance call in the group returns
  // INTERNAL. That happened in production, from a half-merged placeholder that kept its splits and
  // lost its seat. Keeping them is also the honest answer — someone who still owes money belongs on
  // the ledger until they are square.
  const seated = new Set(members.map((m) => m.personId));
  const strays = [...net.keys()].filter((id) => !seated.has(id));
  if (strays.length) {
    const names = new Map(
      (
        await db
          .select({ id: people.id, displayName: people.displayName })
          .from(people)
          .where(inArray(people.id, strays))
          .all()
      ).map((p) => [p.id, p.displayName] as const),
    );
    for (const id of strays) {
      rows.push({
        userId: id,
        displayName: names.get(id) ?? 'Someone who left',
        former: true,
        netCents: net.get(id) ?? 0,
        paidCents: paid.get(id) ?? 0,
        owedCents: owed.get(id) ?? 0,
      });
    }
  }

  return rows;
}
