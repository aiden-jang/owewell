import { allocateCents, computeItemizedSplit, computeSplit } from '@owewell/shared';
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { pruneOrphanPlaceholders } from './people.js';
import {
  expenseItemShares,
  expenseItems,
  expenseSplits,
  expenses,
  groupMembers,
  people,
  settlements,
} from './db/schema.js';
import {
  GroupError,
  memberView,
  requireMembership,
  requireOwner,
  type GroupMemberView,
} from './groups.js';

/*
 * Who is in a group, and what happens to the ledger when that changes.
 *
 * Split out of groups.ts, which had grown to cover two jobs. The group functions next door are about
 * the group as a thing — its name, deadline, share link — and none of them touch the
 * ledger. Everything here does: adding or removing somebody re-splits the expenses they were part
 * of, and getting that wrong moves money that people have already agreed on.
 *
 * The dependency runs one way, members -> groups, which is why the shared guards live over there.
 *
 * `claimPlaceholder` deliberately stayed in groups.ts despite being about a member. It is authorised
 * by a share token rather than by membership — the one call here a non-member is allowed to make —
 * so it belongs with the share-link flow it is the last step of, not with the roster writes.
 */

/**
 * Rename a member. Only name-only placeholders can be renamed here; a real account owns its
 * own display name (synced from the auth service on each sign-in), so renaming it locally
 * would just be overwritten. Any member may fix a placeholder's name.
 */
export async function renameMember(
  db: DB,
  actingPersonId: string,
  groupId: string,
  targetPersonId: string,
  name: string,
): Promise<GroupMemberView> {
  await requireMembership(db, actingPersonId, groupId);
  const membership = await db
    .select({ role: groupMembers.role, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, targetPersonId)))
    .get();
  if (!membership) throw new GroupError('NOT_FOUND', 'They are not in this group.');
  const person = await db
    .select({ isPlaceholder: people.isPlaceholder, authUserId: people.authUserId })
    .from(people)
    .where(eq(people.id, targetPersonId))
    .get();
  if (!person || !person.isPlaceholder || person.authUserId) {
    throw new GroupError('NOT_PLACEHOLDER', 'Only name-only members can be renamed; real accounts manage their own name.');
  }
  await db.update(people).set({ displayName: name }).where(eq(people.id, targetPersonId));
  return memberView(db, groupId, targetPersonId);
}

export interface PaymentHandles {
  venmoHandle: string | null;
  cashappCashtag: string | null;
  paypalHandle: string | null;
}

/** What the endpoint accepts: an omitted field is left unchanged; a blank string clears it. */
export interface PaymentHandleInput {
  venmoHandle?: string | undefined;
  cashappCashtag?: string | undefined;
  paypalHandle?: string | undefined;
}

/**
 * Set a member's payment handles (for settle-up deep links). You may edit your
 * own handles, or those of a name-only placeholder you're in a group with; real
 * accounts other than yourself manage their own. Empty strings clear a handle.
 */
export async function setPaymentHandles(
  db: DB,
  actingPersonId: string,
  groupId: string,
  targetPersonId: string,
  handles: PaymentHandleInput,
): Promise<GroupMemberView> {
  await requireMembership(db, actingPersonId, groupId);
  await requireMembership(db, targetPersonId, groupId); // target must be in the group too
  if (targetPersonId !== actingPersonId) {
    const person = await db
      .select({ isPlaceholder: people.isPlaceholder })
      .from(people)
      .where(eq(people.id, targetPersonId))
      .get();
    if (!person?.isPlaceholder) {
      throw new GroupError('NOT_EDITABLE', 'Only you can set your own payment handles.');
    }
  }
  // Normalize: trim, strip a leading @ / $, and treat blank as clearing (null).
  const clean = (v: string | undefined): string | null | undefined => {
    if (v === undefined) return undefined; // not provided → leave unchanged
    const t = v.trim().replace(/^[@$]/, '');
    return t === '' ? null : t;
  };
  const patch: Partial<PaymentHandles> = {};
  const venmo = clean(handles.venmoHandle);
  const cashapp = clean(handles.cashappCashtag);
  const paypal = clean(handles.paypalHandle);
  if (venmo !== undefined) patch.venmoHandle = venmo;
  if (cashapp !== undefined) patch.cashappCashtag = cashapp;
  if (paypal !== undefined) patch.paypalHandle = paypal;
  if (Object.keys(patch).length > 0) {
    await db.update(people).set(patch).where(eq(people.id, targetPersonId));
  }
  return memberView(db, groupId, targetPersonId);
}

/**
 * When a member joins, fold them into expenses shared by *everyone*: EQUAL expenses split
 * across the whole prior membership re-divide to include them, and itemized receipts where
 * every line item was shared by everyone add them to every item and recompute.
 *
 * Left untouched on purpose: subset splits (deliberately just some people) and EXACT / PERCENT
 * / SHARES expenses (their per-person allocations have no defined value for a newcomer). Those
 * stay manual.
 */
async function replaceSplits(db: DB, expenseId: string, shares: { userId: string; owedCents: number }[]): Promise<void> {
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  await db.insert(expenseSplits).values(
    shares.map((s) => ({ id: crypto.randomUUID(), expenseId, personId: s.userId, owedCents: s.owedCents })),
  );
}

const sameSet = (ids: string[], set: Set<string>): boolean => ids.length === set.size && ids.every((id) => set.has(id));

/** Internal: the roster changed, so everybody's share of the shared expenses did too. */
async function resplitSharedExpenses(
  db: DB,
  groupId: string,
  priorMemberIds: string[],
  newMemberId: string,
): Promise<void> {
  if (priorMemberIds.length === 0) return;
  const priorSet = new Set(priorMemberIds);
  const everyone = [...priorMemberIds, newMemberId];

  const rows = await db
    .select({ id: expenses.id, amountCents: expenses.amountCents, splitMethod: expenses.splitMethod, taxCents: expenses.taxCents, tipCents: expenses.tipCents })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .all();

  for (const e of rows) {
    if (e.splitMethod === 'EQUAL') {
      const parts = (
        await db.select({ personId: expenseSplits.personId }).from(expenseSplits).where(eq(expenseSplits.expenseId, e.id)).all()
      ).map((r) => r.personId);
      if (!sameSet(parts, priorSet)) continue; // subset splits stay as-is
      await replaceSplits(db, e.id, computeSplit('EQUAL', e.amountCents, everyone.map((userId) => ({ userId })), e.id));
    } else if (e.splitMethod === 'ITEMIZED') {
      const itemRows = await db
        .select({ id: expenseItems.id, amountCents: expenseItems.amountCents })
        .from(expenseItems)
        .where(eq(expenseItems.expenseId, e.id))
        .all();
      const shareRows = await db
        .select({ itemId: expenseItemShares.itemId, personId: expenseItemShares.personId })
        .from(expenseItemShares)
        .where(inArray(expenseItemShares.itemId, itemRows.map((i) => i.id)))
        .all();
      const partsByItem = new Map<string, string[]>();
      for (const s of shareRows) partsByItem.set(s.itemId, [...(partsByItem.get(s.itemId) ?? []), s.personId]);
      // Only receipts where *every* item was shared by everyone.
      if (!itemRows.every((i) => sameSet(partsByItem.get(i.id) ?? [], priorSet))) continue;
      for (const i of itemRows) {
        await db.insert(expenseItemShares).values({ id: crypto.randomUUID(), itemId: i.id, personId: newMemberId });
      }
      const shares = computeItemizedSplit({
        items: itemRows.map((i) => ({ amountCents: i.amountCents, participantIds: everyone })),
        taxCents: e.taxCents,
        tipCents: e.tipCents,
        seed: e.id,
      });
      await replaceSplits(db, e.id, shares);
    }
  }
}

/** Add a name-only person (no account) to the group, backed by a placeholder people row. */
export async function addPlaceholderMember(db: DB, personId: string, groupId: string, name: string): Promise<GroupMemberView> {
  await requireMembership(db, personId, groupId);
  const priorMemberIds = (
    await db.select({ id: groupMembers.personId }).from(groupMembers).where(eq(groupMembers.groupId, groupId)).all()
  ).map((r) => r.id);
  const newPersonId = crypto.randomUUID();
  await db.insert(people).values({ id: newPersonId, displayName: name, isPlaceholder: true });
  await db.insert(groupMembers).values({ id: crypto.randomUUID(), groupId, personId: newPersonId, role: 'MEMBER' });
  await resplitSharedExpenses(db, groupId, priorMemberIds, newPersonId);
  return {
    userId: newPersonId,
    displayName: name,
    email: null,
    role: 'MEMBER',
    joinedAt: new Date(),
    isPlaceholder: true,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
  };
}

/**
 * "Un-add" a member from the ledger: re-split each expense as if they were never a participant
 * (their owed share is redistributed across the remaining participants), and hand anything they
 * paid over to `ownerId` so the outlay isn't lost. No settlements are created. Keeps the ledger
 * zero-sum without fabricating payments.
 */
async function unaddFromLedger(db: DB, groupId: string, personId: string, ownerId: string): Promise<void> {
  const exps = await db
    .select({ id: expenses.id, payerId: expenses.payerId })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .all();

  for (const e of exps) {
    // Anything they paid is taken over by the owner (so the payment isn't lost).
    if (e.payerId === personId) {
      await db.update(expenses).set({ payerId: ownerId }).where(eq(expenses.id, e.id));
    }
    await db
      .update(expenseItems)
      .set({ payerId: ownerId })
      .where(and(eq(expenseItems.expenseId, e.id), eq(expenseItems.payerId, personId)));

    // Redistribute their owed share across the remaining participants (proportionally).
    const splits = await db
      .select({ id: expenseSplits.id, personId: expenseSplits.personId, owedCents: expenseSplits.owedCents })
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, e.id))
      .all();
    const mine = splits.find((s) => s.personId === personId);
    if (mine) {
      const others = splits.filter((s) => s.personId !== personId);
      if (others.length === 0) {
        // They were the only participant — the expense is theirs, so it leaves with them.
        await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, e.id));
      } else {
        const weights = others.map((o) => o.owedCents);
        const hasWeight = weights.some((w) => w > 0);
        const add = allocateCents(mine.owedCents, hasWeight ? weights : others.map(() => 1));
        for (let i = 0; i < others.length; i++) {
          await db
            .update(expenseSplits)
            .set({ owedCents: others[i]!.owedCents + add[i]! })
            .where(eq(expenseSplits.id, others[i]!.id));
        }
        await db.delete(expenseSplits).where(eq(expenseSplits.id, mine.id));
      }
    }

    // Drop them from itemized item shares (detail cleanup; balances come from the splits above).
    const itemIds = (
      await db.select({ id: expenseItems.id }).from(expenseItems).where(eq(expenseItems.expenseId, e.id)).all()
    ).map((i) => i.id);
    if (itemIds.length) {
      await db
        .delete(expenseItemShares)
        .where(and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, personId)));
    }
  }

  // Any settlements referencing them are dropped — they're leaving the ledger entirely.
  await db
    .delete(settlements)
    .where(
      and(eq(settlements.groupId, groupId), or(eq(settlements.fromPersonId, personId), eq(settlements.toPersonId, personId))),
    );
}

/** Remove a member. Owner can remove others; the owner can't be removed (delete the group
 * instead). Only allowed before any payment is recorded: removal re-splits the member out of the
 * expenses, which would invalidate settlements already logged — so once anyone's been marked
 * paid, removal is blocked. In the allowed case their share re-splits among the people who
 * remain and anything they paid is handed to the owner; no settlements are invented. */
export async function removeMember(db: DB, actingPersonId: string, groupId: string, targetPersonId: string): Promise<void> {
  await requireMembership(db, actingPersonId, groupId);
  const target = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, targetPersonId)))
    .get();
  if (!target) throw new GroupError('NOT_FOUND', 'They are not in this group.');
  if (target.role === 'OWNER') {
    throw new GroupError('CANNOT_REMOVE_OWNER', 'The owner cannot be removed; delete the group instead.');
  }
  if (targetPersonId !== actingPersonId) {
    await requireOwner(db, actingPersonId, groupId);
  }

  // Removal re-splits expenses, which would break any payment already recorded against the old
  // split. So it's only allowed while the group has no settlements yet.
  const settled = await db.select({ c: count() }).from(settlements).where(eq(settlements.groupId, groupId)).get();
  if ((settled?.c ?? 0) > 0) {
    throw new GroupError(
      'HAS_ACTIVITY',
      'You can only remove someone before any payments are recorded. A payment has already been logged here.',
    );
  }

  const owner = await db
    .select({ personId: groupMembers.personId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'OWNER')))
    .get();
  await unaddFromLedger(db, groupId, targetPersonId, owner?.personId ?? actingPersonId);

  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, targetPersonId)));
  await pruneOrphanPlaceholders(db);
}
