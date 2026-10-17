import { inIds } from './db/ids.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import {
  expenseItemShares,
  expenseItems,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  people,
  settlements,
} from './db/schema.js';
import type { BatchItem } from 'drizzle-orm/batch';
import { simplifyDebts } from '@owewell/shared';
import { computeBalances } from './balances.js';
import { mintShareToken } from './shareToken.js';
import { pruneOrphanPlaceholders } from './people.js';
import { GroupError, requireMembership, requireOwner } from './groups.js';

// Read-only summaries and placeholder claims are authorized by the share token.

/** The read-only view served on the public share page. Deliberately excludes payment handles
 *  and individual line items — just totals, balances, and who-owes-who. */
export interface SharedGroupSummary {
  groupId: string;
  groupName: string;
  memberCount: number;
  totalSpentCents: number;
  perPersonCents: number;
  totalSettledCents: number;
  members: { userId: string; displayName: string; netCents: number; isPlaceholder: boolean }[];
  suggested: { fromName: string; toName: string; amountCents: number }[];
  breakdown: { category: string; cents: number }[];
}

/** Two UUIDs' worth of entropy, hex only, so the link isn't guessable. */
/** Create (once) or return the group's public share token. Members only. */
export async function getOrCreateShareToken(db: DB, personId: string, groupId: string): Promise<string> {
  await requireMembership(db, personId, groupId);
  const g = await db
    .select({ shareToken: groups.shareToken })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();
  if (!g) throw new GroupError('NOT_FOUND', 'Group not found.');
  if (g.shareToken) return g.shareToken;
  const token = mintShareToken();
  await db.update(groups).set({ shareToken: token }).where(eq(groups.id, groupId));
  return token;
}

// Only the owner can revoke a link. Claimed seats retain membership independently of that token.

/** Replace the token, so every copy of the old link stops resolving. Returns the new one. */
export async function rotateShareToken(db: DB, personId: string, groupId: string): Promise<string> {
  await requireOwner(db, personId, groupId);
  const token = mintShareToken();
  await db.update(groups).set({ shareToken: token }).where(eq(groups.id, groupId));
  return token;
}

/** Clear the token, so the group has no public view at all until somebody makes a new link. */
export async function revokeShareToken(db: DB, personId: string, groupId: string): Promise<void> {
  await requireOwner(db, personId, groupId);
  await db.update(groups).set({ shareToken: null }).where(eq(groups.id, groupId));
}

/** Resolve a share token to its read-only summary. No auth: anyone with the link may view.
 *  Returns null when the token doesn't match a group. */
export async function getSharedSummary(db: DB, token: string): Promise<SharedGroupSummary | null> {
  if (!token) return null;
  const g = await db.select().from(groups).where(eq(groups.shareToken, token)).get();
  if (!g) return null;

  const balances = await computeBalances(db, g.id);
  const nameByPerson = new Map(balances.map((b) => [b.userId, b.displayName]));
  const suggested = simplifyDebts(balances.map((b) => ({ userId: b.userId, netCents: b.netCents }))).map(
    (t) => ({
      fromName: nameByPerson.get(t.fromUserId) ?? 'Someone',
      toName: nameByPerson.get(t.toUserId) ?? 'Someone',
      amountCents: t.amountCents,
    }),
  );

  const exps = await db
    .select({ amountCents: expenses.amountCents, category: expenses.category })
    .from(expenses)
    .where(and(eq(expenses.groupId, g.id), isNull(expenses.deletedAt)))
    .all();
  const totalSpentCents = exps.reduce((sum, e) => sum + e.amountCents, 0);
  const setl = await db
    .select({ amountCents: settlements.amountCents })
    .from(settlements)
    .where(eq(settlements.groupId, g.id))
    .all();
  const totalSettledCents = setl.reduce((sum, s) => sum + s.amountCents, 0);
  const catTotals = new Map<string, number>();
  for (const e of exps) {
    const key = e.category ?? 'other';
    catTotals.set(key, (catTotals.get(key) ?? 0) + e.amountCents);
  }
  const breakdown = [...catTotals.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);

  // Which seats are unclaimed placeholders (claimable) vs real accounts.
  const flags = await db
    .select({ id: people.id, isPlaceholder: people.isPlaceholder })
    .from(people)
    .where(
      inIds(
        people.id,
        balances.map((b) => b.userId),
      ),
    )
    .all();
  const isPlaceholderById = new Map(flags.map((f) => [f.id, f.isPlaceholder]));

  return {
    groupId: g.id,
    groupName: g.name,
    memberCount: balances.length,
    totalSpentCents,
    perPersonCents: balances.length ? Math.round(totalSpentCents / balances.length) : 0,
    totalSettledCents,
    members: balances.map((b) => ({
      userId: b.userId,
      displayName: b.displayName,
      netCents: b.netCents,
      isPlaceholder: isPlaceholderById.get(b.userId) ?? false,
    })),
    suggested,
    breakdown,
  };
}

/**
 * Claim an unclaimed seat (placeholder) via a share token, merging it into the signed-in caller.
 * Everything the placeholder was attached to — its membership, expenses paid, splits owed, and
 * settlements — is repointed to the caller, who becomes a real member able to edit. The empty
 * placeholder person is then pruned. Trust-based: anyone with the link may claim a seat.
 */
export async function claimPlaceholder(
  db: DB,
  callerPersonId: string,
  token: string,
  placeholderId: string,
): Promise<{ groupId: string }> {
  const g = await db.select({ id: groups.id }).from(groups).where(eq(groups.shareToken, token)).get();
  if (!g) throw new GroupError('NOT_FOUND', 'This share link is not valid.');
  const groupId = g.id;

  if (placeholderId === callerPersonId)
    throw new GroupError('NOT_PLACEHOLDER', 'That seat is already yours.');

  // The seat must be an unclaimed placeholder that belongs to this group.
  const seat = await db
    .select({ role: groupMembers.role, isPlaceholder: people.isPlaceholder })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, placeholderId)))
    .get();
  if (!seat) throw new GroupError('NOT_FOUND', 'That seat is not in this group.');
  if (!seat.isPlaceholder)
    throw new GroupError('NOT_PLACEHOLDER', 'That seat already belongs to an account.');

  // The caller can't already be in the group (they'd end up with two seats).
  const already = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, callerPersonId)))
    .get();
  if (already) throw new GroupError('ALREADY_MEMBER', "You're already in this group.");

  // ── Repoint every reference from the placeholder to the caller, scoped to this group. ──
  //
  // An identity merge on a ledger, so it is all-or-nothing. Done as sequential awaits with the
  // membership row moved first, any later failure leaves the seat owned by the caller and the money
  // on the placeholder; balances then stop summing to zero and every balance call 500s. That
  // happened in production.
  //
  // And it will fail: expense_splits is unique on (expense_id, person_id), so if the caller already
  // has a split on an expense the placeholder is also on, a plain repoint collides. Two rows for the
  // same human must be MERGED, not renamed.
  const expIds = (
    await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).all()
  ).map((e) => e.id);

  const mine = expIds.length
    ? await db
        .select({
          id: expenseSplits.id,
          expenseId: expenseSplits.expenseId,
          owedCents: expenseSplits.owedCents,
        })
        .from(expenseSplits)
        .where(and(inIds(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, placeholderId)))
        .all()
    : [];
  const theirs = expIds.length
    ? await db
        .select({
          id: expenseSplits.id,
          expenseId: expenseSplits.expenseId,
          owedCents: expenseSplits.owedCents,
        })
        .from(expenseSplits)
        .where(and(inIds(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, callerPersonId)))
        .all()
    : [];
  const callerSplitByExpense = new Map(theirs.map((t) => [t.expenseId, t]));

  const itemIds = expIds.length
    ? (
        await db
          .select({ id: expenseItems.id })
          .from(expenseItems)
          .where(inIds(expenseItems.expenseId, expIds))
          .all()
      ).map((i) => i.id)
    : [];
  // expense_item_shares has its own unique (item_id, person_id), and shares carry no amount, so a
  // collision there is a plain duplicate to drop rather than a sum to merge.
  const theirsShares = itemIds.length
    ? await db
        .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
        .from(expenseItemShares)
        .where(and(inIds(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, callerPersonId)))
        .all()
    : [];
  const dupShareIds = itemIds.length
    ? (
        await db
          .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
          .from(expenseItemShares)
          .where(and(inIds(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId)))
          .all()
      )
        .filter((ph) => theirsShares.some((t) => t.itemId === ph.itemId))
        .map((ph) => ph.id)
    : [];

  // Typed explicitly: TypeScript infers an array's element type from its first entry, so a batch of
  // updates across different tables fails to typecheck without this.
  const writes: BatchItem<'sqlite'>[] = [
    db
      .update(groupMembers)
      .set({ personId: callerPersonId })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, placeholderId))),
  ];

  if (expIds.length) {
    writes.push(
      db
        .update(expenses)
        .set({ payerId: callerPersonId })
        .where(and(eq(expenses.groupId, groupId), eq(expenses.payerId, placeholderId))),
      db
        .update(expenseItems)
        .set({ payerId: callerPersonId })
        .where(and(inIds(expenseItems.expenseId, expIds), eq(expenseItems.payerId, placeholderId))),
    );

    for (const ph of mine) {
      const collision = callerSplitByExpense.get(ph.expenseId);
      if (collision) {
        // Same human, two seats on one bill: add the shares together and drop the placeholder row.
        writes.push(
          db
            .update(expenseSplits)
            .set({ owedCents: collision.owedCents + ph.owedCents })
            .where(eq(expenseSplits.id, collision.id)),
          db.delete(expenseSplits).where(eq(expenseSplits.id, ph.id)),
        );
      } else {
        writes.push(
          db.update(expenseSplits).set({ personId: callerPersonId }).where(eq(expenseSplits.id, ph.id)),
        );
      }
    }

    if (itemIds.length) {
      if (dupShareIds.length) {
        writes.push(db.delete(expenseItemShares).where(inIds(expenseItemShares.id, dupShareIds)));
      }
      writes.push(
        db
          .update(expenseItemShares)
          .set({ personId: callerPersonId })
          .where(
            and(inIds(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId)),
          ),
      );
    }
  }

  writes.push(
    db
      .update(settlements)
      .set({ fromPersonId: callerPersonId })
      .where(and(eq(settlements.groupId, groupId), eq(settlements.fromPersonId, placeholderId))),
    db
      .update(settlements)
      .set({ toPersonId: callerPersonId })
      .where(and(eq(settlements.groupId, groupId), eq(settlements.toPersonId, placeholderId))),
  );

  // D1 runs a batch as one implicit transaction, so a failure anywhere rolls the whole merge back and
  // the group is left consistent (seat and money both still on the placeholder) rather than split.
  await db.batch(writes as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  // The placeholder is now unreferenced; clean it up.
  await pruneOrphanPlaceholders(db);
  return { groupId };
}
