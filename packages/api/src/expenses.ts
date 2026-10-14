import { insertRows } from './db/rows.js';
import { changedFields, computeSplit, type SplitMethod } from '@owewell/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import {
  assertUnlocked,
  assertVersion,
  clearItemizedRows,
  findByClientId,
  memberPersonIds,
} from './expenseGuards.js';
import { listExpenses } from './expenseList.js';
// Balance reading moved to its own module; re-exported so callers keep one import site.
export { getBalances } from './balances.js';
import { expenseRevisions, expenseSplits, expenses } from './db/schema.js';

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
  await insertRows(
    db,
    expenseSplits,
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
  await insertRows(
    db,
    expenseSplits,
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
