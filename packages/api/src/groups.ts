import { computeSplit, computeItemizedSplit, computeItemizedPayers, simplifyDebts, allocateCents } from '@owewell/shared';
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
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

async function requireOwner(db: DB, personId: string, groupId: string): Promise<void> {
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
async function memberView(db: DB, groupId: string, personId: string): Promise<GroupMemberView> {
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
export async function setGroupArchived(db: DB, personId: string, groupId: string, archived: boolean): Promise<GroupDetail> {
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

/** Create (once) or return the group's public share token. Members only. */
export async function getOrCreateShareToken(db: DB, personId: string, groupId: string): Promise<string> {
  await requireMembership(db, personId, groupId);
  const g = await db.select({ shareToken: groups.shareToken }).from(groups).where(eq(groups.id, groupId)).get();
  if (!g) throw new GroupError('NOT_FOUND', 'Group not found.');
  if (g.shareToken) return g.shareToken;
  // Two UUIDs' worth of entropy, hex only, so the link isn't guessable.
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  await db.update(groups).set({ shareToken: token }).where(eq(groups.id, groupId));
  return token;
}

/** Resolve a share token to its read-only summary. No auth: anyone with the link may view.
 *  Returns null when the token doesn't match a group. */
export async function getSharedSummary(db: DB, token: string): Promise<SharedGroupSummary | null> {
  if (!token) return null;
  const g = await db.select().from(groups).where(eq(groups.shareToken, token)).get();
  if (!g) return null;

  const balances = await computeBalances(db, g.id);
  const nameByPerson = new Map(balances.map((b) => [b.userId, b.displayName]));
  const suggested = simplifyDebts(balances.map((b) => ({ userId: b.userId, netCents: b.netCents }))).map((t) => ({
    fromName: nameByPerson.get(t.fromUserId) ?? 'Someone',
    toName: nameByPerson.get(t.toUserId) ?? 'Someone',
    amountCents: t.amountCents,
  }));

  const exps = await db
    .select({ amountCents: expenses.amountCents, category: expenses.category })
    .from(expenses)
    .where(and(eq(expenses.groupId, g.id), isNull(expenses.deletedAt)))
    .all();
  const totalSpentCents = exps.reduce((sum, e) => sum + e.amountCents, 0);
  const setl = await db.select({ amountCents: settlements.amountCents }).from(settlements).where(eq(settlements.groupId, g.id)).all();
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
    .where(inArray(people.id, balances.map((b) => b.userId)))
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

  if (placeholderId === callerPersonId) throw new GroupError('NOT_PLACEHOLDER', "That seat is already yours.");

  // The seat must be an unclaimed placeholder that belongs to this group.
  const seat = await db
    .select({ role: groupMembers.role, isPlaceholder: people.isPlaceholder })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, placeholderId)))
    .get();
  if (!seat) throw new GroupError('NOT_FOUND', 'That seat is not in this group.');
  if (!seat.isPlaceholder) throw new GroupError('NOT_PLACEHOLDER', 'That seat already belongs to an account.');

  // The caller can't already be in the group (they'd end up with two seats).
  const already = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, callerPersonId)))
    .get();
  if (already) throw new GroupError('ALREADY_MEMBER', "You're already in this group.");

  // ── Repoint every reference from the placeholder to the caller, scoped to this group. ──
  //
  // This is an identity merge on a ledger, so it is all-or-nothing. It used to be eight sequential
  // awaits with the membership row moved FIRST, which meant any later failure left the seat owned by
  // the caller and the money still attached to the placeholder. Balances then stopped summing to zero
  // and every balance call in the group 500'd forever. That happened in production.
  //
  // The failure was not hypothetical either: expense_splits has a unique index on
  // (expense_id, person_id), so if the caller already had a split on an expense the placeholder was
  // also on, a plain repoint collides. Two rows for the same human have to be MERGED, not renamed.
  const expIds = (await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).all()).map((e) => e.id);

  const mine = expIds.length
    ? await db
        .select({ id: expenseSplits.id, expenseId: expenseSplits.expenseId, owedCents: expenseSplits.owedCents })
        .from(expenseSplits)
        .where(and(inArray(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, placeholderId)))
        .all()
    : [];
  const theirs = expIds.length
    ? await db
        .select({ id: expenseSplits.id, expenseId: expenseSplits.expenseId, owedCents: expenseSplits.owedCents })
        .from(expenseSplits)
        .where(and(inArray(expenseSplits.expenseId, expIds), eq(expenseSplits.personId, callerPersonId)))
        .all()
    : [];
  const callerSplitByExpense = new Map(theirs.map((t) => [t.expenseId, t]));

  const itemIds = expIds.length
    ? (await db.select({ id: expenseItems.id }).from(expenseItems).where(inArray(expenseItems.expenseId, expIds)).all()).map((i) => i.id)
    : [];
  // expense_item_shares has its own unique (item_id, person_id), and shares carry no amount, so a
  // collision there is a plain duplicate to drop rather than a sum to merge.
  const theirsShares = itemIds.length
    ? await db
        .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
        .from(expenseItemShares)
        .where(and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, callerPersonId)))
        .all()
    : [];
  const dupShareIds = itemIds.length
    ? (
        await db
          .select({ id: expenseItemShares.id, itemId: expenseItemShares.itemId })
          .from(expenseItemShares)
          .where(and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId)))
          .all()
      )
        .filter((ph) =>
          theirsShares.some((t) => t.itemId === ph.itemId),
        )
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
      db.update(expenses).set({ payerId: callerPersonId }).where(and(eq(expenses.groupId, groupId), eq(expenses.payerId, placeholderId))),
      db.update(expenseItems).set({ payerId: callerPersonId }).where(and(inArray(expenseItems.expenseId, expIds), eq(expenseItems.payerId, placeholderId))),
    );

    for (const ph of mine) {
      const collision = callerSplitByExpense.get(ph.expenseId);
      if (collision) {
        // Same human, two seats on one bill: add the shares together and drop the placeholder row.
        writes.push(
          db.update(expenseSplits).set({ owedCents: collision.owedCents + ph.owedCents }).where(eq(expenseSplits.id, collision.id)),
          db.delete(expenseSplits).where(eq(expenseSplits.id, ph.id)),
        );
      } else {
        writes.push(db.update(expenseSplits).set({ personId: callerPersonId }).where(eq(expenseSplits.id, ph.id)));
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
          .where(and(inArray(expenseItemShares.itemId, itemIds), eq(expenseItemShares.personId, placeholderId))),
      );
    }
  }

  writes.push(
    db.update(settlements).set({ fromPersonId: callerPersonId }).where(and(eq(settlements.groupId, groupId), eq(settlements.fromPersonId, placeholderId))),
    db.update(settlements).set({ toPersonId: callerPersonId }).where(and(eq(settlements.groupId, groupId), eq(settlements.toPersonId, placeholderId))),
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
      .select({ expenseId: expenseItems.expenseId, amountCents: expenseItems.amountCents, payerId: expenseItems.payerId })
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
      });
      for (const p of payers) bump(e.groupId, p.userId, p.paidCents);
    } else {
      bump(e.groupId, e.payerId, e.amountCents);
    }
  }

  // Debit side: everyone's owed shares.
  if (exps.length) {
    const splitRows = await db
      .select({ expenseId: expenseSplits.expenseId, personId: expenseSplits.personId, owedCents: expenseSplits.owedCents })
      .from(expenseSplits)
      .where(inArray(expenseSplits.expenseId, exps.map((e) => e.id)))
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
    })
    .from(settlements)
    .where(inArray(settlements.groupId, ids))
    .all();
  for (const s of setl) {
    bump(s.groupId, s.fromPersonId, s.amountCents);
    bump(s.groupId, s.toPersonId, -s.amountCents);
  }

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
      isOwner: g.role === 'OWNER',
    };
  });
}

export async function renameGroup(db: DB, personId: string, groupId: string, name: string): Promise<GroupDetail> {
  await requireOwner(db, personId, groupId);
  await db.update(groups).set({ name }).where(eq(groups.id, groupId));
  return getGroup(db, personId, groupId);
}

export async function deleteGroup(db: DB, personId: string, groupId: string): Promise<void> {
  await requireOwner(db, personId, groupId);
  // Explicit cascade (don't rely on SQLite FK enforcement in D1).
  const exps = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).all();
  const expIds = exps.map((e) => e.id);
  if (expIds.length) {
    const items = await db.select({ id: expenseItems.id }).from(expenseItems).where(inArray(expenseItems.expenseId, expIds)).all();
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

export async function resplitSharedExpenses(
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
