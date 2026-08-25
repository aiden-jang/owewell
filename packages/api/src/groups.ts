import { computeItemizedPayers, simplifyDebts } from '@owewell/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { computeBalances } from './expenses.js';
import { pruneOrphanPlaceholders } from './people.js';
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

export type GroupErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'NOT_OWNER'
  | 'CANNOT_REMOVE_OWNER'
  | 'NOT_PLACEHOLDER'
  | 'NOT_EDITABLE'
  | 'HAS_ACTIVITY';

export class GroupError extends Error {
  constructor(
    readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GroupError';
  }
}

export interface GroupMemberView {
  userId: string; // owewell person id (opaque member id to the frontend)
  displayName: string;
  email: string | null;
  role: string;
  joinedAt: Date;
  isPlaceholder: boolean;
  // Payment handles (without @ / $), for settle-up deep links. Null when unset.
  venmoHandle: string | null;
  cashappCashtag: string | null;
  paypalHandle: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  createdById: string;
  createdAt: Date;
  archived: boolean;
  viewerId: string; // the caller's person id, so the UI knows which member is "me"
  members: GroupMemberView[];
}

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: Date;
  archived: boolean;
  memberCount: number;
  netCents: number;
  totalUnsettledCents: number;
  /** Total spent on expenses in this group. 0 means no expenses yet (distinct from settled). */
  totalSpentCents: number;
  /**
   * The last time anything happened here: newest expense or settlement, falling back to when the group
   * was made. "Created 8 months ago" is trivia; "nothing since March" is what tells you a group is done.
   */
  lastActivityAt: Date;
  isOwner: boolean;
}

/** Throws NOT_FOUND if the person is not a member (which doubles as "does not exist"). */
export async function requireMembership(db: DB, personId: string, groupId: string): Promise<string> {
  const m = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, personId)))
    .get();
  if (!m) throw new GroupError('NOT_FOUND', 'Group not found.');
  return m.role;
}

export async function requireOwner(db: DB, personId: string, groupId: string): Promise<void> {
  const role = await requireMembership(db, personId, groupId);
  if (role !== 'OWNER') throw new GroupError('NOT_OWNER', 'Only the group owner can do that.');
}

async function membersOf(db: DB, groupId: string): Promise<GroupMemberView[]> {
  const rows = await db
    .select({
      userId: groupMembers.personId,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
      displayName: people.displayName,
      isPlaceholder: people.isPlaceholder,
      venmoHandle: people.venmoHandle,
      cashappCashtag: people.cashappCashtag,
      paypalHandle: people.paypalHandle,
    })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(groupMembers.joinedAt)
    .all();
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    email: null, // real users' emails live in the auth service, not owewell
    role: r.role,
    joinedAt: r.joinedAt,
    isPlaceholder: r.isPlaceholder,
    venmoHandle: r.venmoHandle,
    cashappCashtag: r.cashappCashtag,
    paypalHandle: r.paypalHandle,
  }));
}

/** One member's view, freshly read (includes payment handles). Throws NOT_FOUND if absent. */
export async function memberView(db: DB, groupId: string, personId: string): Promise<GroupMemberView> {
  const m = (await membersOf(db, groupId)).find((x) => x.userId === personId);
  if (!m) throw new GroupError('NOT_FOUND', 'They are not in this group.');
  return m;
}

export async function getGroup(db: DB, personId: string, groupId: string): Promise<GroupDetail> {
  await requireMembership(db, personId, groupId);
  const g = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!g) throw new GroupError('NOT_FOUND', 'Group not found.');
  // `archived` is the caller's own view (personal hide), not a group-wide state.
  const mine = await db
    .select({ archivedAt: groupMembers.archivedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, personId)))
    .get();
  return {
    id: g.id,
    name: g.name,
    createdById: g.createdById,
    createdAt: g.createdAt,
    archived: mine?.archivedAt != null,
    viewerId: personId,
    members: await membersOf(db, groupId),
  };
}

/** Archive (or restore) a group in the caller's own view. Any member may do this; it's a
 *  personal "hide from my list", not a group-wide freeze — the group stays live for everyone. */
export async function setGroupArchived(
  db: DB,
  personId: string,
  groupId: string,
  archived: boolean,
): Promise<GroupDetail> {
  await requireMembership(db, personId, groupId);
  await db
    .update(groupMembers)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, personId)));
  return getGroup(db, personId, groupId);
}

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
function mintShareToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

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

/*
 * Taking a share link back. Without it the only remedy for a forwarded URL is deleting the group,
 * which takes the ledger with it.
 *
 * Owner-only, matching rename and delete: it changes what everybody outside the group can see.
 * Members are unaffected — a claimed seat is a real membership and does not depend on the token
 * that introduced it.
 */

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
      inArray(
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
        .where(and(inArray(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, placeholderId)))
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
        .where(and(inArray(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, callerPersonId)))
        .all()
    : [];
  const callerSplitByExpense = new Map(theirs.map((t) => [t.expenseId, t]));

  const itemIds = expIds.length
    ? (
        await db
          .select({ id: expenseItems.id })
          .from(expenseItems)
          .where(inArray(expenseItems.expenseId, expIds))
          .all()
      ).map((i) => i.id)
    : [];
  // expense_item_shares has its own unique (item_id, person_id), and shares carry no amount, so a
  // collision there is a plain duplicate to drop rather than a sum to merge.
  const theirsShares = itemIds.length
    ? await db
        .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
        .from(expenseItemShares)
        .where(
          and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, callerPersonId)),
        )
        .all()
    : [];
  const dupShareIds = itemIds.length
    ? (
        await db
          .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
          .from(expenseItemShares)
          .where(
            and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId)),
          )
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
        .where(and(inArray(expenseItems.expenseId, expIds), eq(expenseItems.payerId, placeholderId))),
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
        writes.push(db.delete(expenseItemShares).where(inArray(expenseItemShares.id, dupShareIds)));
      }
      writes.push(
        db
          .update(expenseItemShares)
          .set({ personId: callerPersonId })
          .where(
            and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId)),
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

export async function createGroup(db: DB, personId: string, name: string): Promise<GroupDetail> {
  const id = crypto.randomUUID();
  await db.insert(groups).values({ id, name, createdById: personId });
  await db.insert(groupMembers).values({ id: crypto.randomUUID(), groupId: id, personId, role: 'OWNER' });
  return getGroup(db, personId, id);
}

export async function listGroups(db: DB, personId: string): Promise<GroupSummary[]> {
  // `archivedAt` here is the viewer's own membership flag (personal hide), not group-wide.
  const mine = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      archivedAt: groupMembers.archivedAt,
      role: groupMembers.role,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.personId, personId))
    .orderBy(desc(groups.createdAt))
    .all();
  const ids = mine.map((g) => g.id);
  if (ids.length === 0) return [];

  const counts = await db
    .select({ groupId: groupMembers.groupId, c: count() })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, ids))
    .groupBy(groupMembers.groupId)
    .all();
  const countMap = new Map(counts.map((r) => [r.groupId, Number(r.c)]));

  // Per-member net for every group at once, mirroring getBalances (including itemized per-item
  // payers + proportional tax/tip) so the dashboard agrees with the group page. From this we
  // read off the caller's net AND the group's total outstanding (sum of positive balances).
  const net = new Map<string, Map<string, number>>(); // groupId -> personId -> cents
  const bump = (groupId: string, memberId: string, d: number): void => {
    let m = net.get(groupId);
    if (!m) {
      m = new Map();
      net.set(groupId, m);
    }
    m.set(memberId, (m.get(memberId) ?? 0) + d);
  };

  const exps = await db
    .select({
      id: expenses.id,
      groupId: expenses.groupId,
      payerId: expenses.payerId,
      amountCents: expenses.amountCents,
      splitMethod: expenses.splitMethod,
      taxCents: expenses.taxCents,
      tipCents: expenses.tipCents,
      createdAt: expenses.createdAt,
      date: expenses.date,
    })
    .from(expenses)
    .where(and(inArray(expenses.groupId, ids), isNull(expenses.deletedAt)))
    .all();
  const groupOfExpense = new Map(exps.map((e) => [e.id, e.groupId]));

  // Total spent per group — lets the dashboard tell a brand-new group (nothing spent) apart from a
  // fully-paid-off one (both net to zero), so it doesn't label an empty group "settled".
  const spentByGroup = new Map<string, number>();
  for (const e of exps) spentByGroup.set(e.groupId, (spentByGroup.get(e.groupId) ?? 0) + e.amountCents);

  // Credit side: per-item payers for itemized expenses, else the single payer.
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
      for (const p of payers) bump(e.groupId, p.userId, p.paidCents);
    } else {
      bump(e.groupId, e.payerId, e.amountCents);
    }
  }

  // Debit side: everyone's owed shares.
  if (exps.length) {
    const splitRows = await db
      .select({
        expenseId: expenseSplits.expenseId,
        personId: expenseSplits.personId,
        owedCents: expenseSplits.owedCents,
      })
      .from(expenseSplits)
      .where(
        inArray(
          expenseSplits.expenseId,
          exps.map((e) => e.id),
        ),
      )
      .all();
    for (const s of splitRows) {
      const g = groupOfExpense.get(s.expenseId);
      if (g) bump(g, s.personId, -s.owedCents);
    }
  }

  // Settlements move money between the two parties.
  const setl = await db
    .select({
      groupId: settlements.groupId,
      fromPersonId: settlements.fromPersonId,
      toPersonId: settlements.toPersonId,
      amountCents: settlements.amountCents,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .where(inArray(settlements.groupId, ids))
    .all();
  for (const s of setl) {
    bump(s.groupId, s.fromPersonId, s.amountCents);
    bump(s.groupId, s.toPersonId, -s.amountCents);
  }

  // Newest expense or settlement per group. Expenses are backdatable, so an expense counts as activity
  // at whichever is later: when it happened, or when it was entered. Otherwise backdating a receipt
  // from last month would make a group look stale the moment you added to it.
  const lastActivity = new Map<string, number>();
  const touch = (groupId: string, at: Date | null | undefined): void => {
    const ms = at?.getTime();
    if (ms === undefined) return;
    if (ms > (lastActivity.get(groupId) ?? 0)) lastActivity.set(groupId, ms);
  };
  for (const e of exps) {
    touch(e.groupId, e.createdAt);
    touch(e.groupId, e.date);
  }
  for (const s of setl) touch(s.groupId, s.createdAt);

  return mine.map((g) => {
    const members = net.get(g.id);
    let totalUnsettledCents = 0;
    if (members) for (const v of members.values()) if (v > 0) totalUnsettledCents += v;
    return {
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      archived: g.archivedAt !== null,
      memberCount: countMap.get(g.id) ?? 0,
      netCents: members?.get(personId) ?? 0,
      totalUnsettledCents,
      totalSpentCents: spentByGroup.get(g.id) ?? 0,
      // Falls back to the group's own creation, so a brand-new empty group still has a sensible date.
      lastActivityAt: new Date(Math.max(lastActivity.get(g.id) ?? 0, g.createdAt.getTime())),
      isOwner: g.role === 'OWNER',
    };
  });
}

export async function renameGroup(
  db: DB,
  personId: string,
  groupId: string,
  name: string,
): Promise<GroupDetail> {
  await requireOwner(db, personId, groupId);
  await db.update(groups).set({ name }).where(eq(groups.id, groupId));
  return getGroup(db, personId, groupId);
}

/** Delete a group and everything under it. */
export async function deleteGroup(db: DB, personId: string, groupId: string): Promise<void> {
  await requireOwner(db, personId, groupId);
  // Explicit cascade (don't rely on SQLite FK enforcement in D1).
  const exps = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).all();
  const expIds = exps.map((e) => e.id);
  if (expIds.length) {
    const items = await db
      .select({ id: expenseItems.id })
      .from(expenseItems)
      .where(inArray(expenseItems.expenseId, expIds))
      .all();
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) await db.delete(expenseItemShares).where(inArray(expenseItemShares.itemId, itemIds));
    await db.delete(expenseItems).where(inArray(expenseItems.expenseId, expIds));
    await db.delete(expenseSplits).where(inArray(expenseSplits.expenseId, expIds));
    await db.delete(expenses).where(inArray(expenses.id, expIds));
  }
  await db.delete(settlements).where(eq(settlements.groupId, groupId));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  await db.delete(groups).where(eq(groups.id, groupId));
  await pruneOrphanPlaceholders(db);
}
