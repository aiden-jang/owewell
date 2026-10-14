import { inIds } from './db/ids.js';
import { computeItemizedPayers } from '@owewell/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client.js';
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
    .where(inIds(groupMembers.groupId, ids))
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
    .where(and(inIds(expenses.groupId, ids), isNull(expenses.deletedAt)))
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
      .where(inIds(expenseItems.expenseId, itemizedIds))
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
        inIds(
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
    .where(inIds(settlements.groupId, ids))
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
      .where(inIds(expenseItems.expenseId, expIds))
      .all();
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) await db.delete(expenseItemShares).where(inIds(expenseItemShares.itemId, itemIds));
    await db.delete(expenseItems).where(inIds(expenseItems.expenseId, expIds));
    await db.delete(expenseSplits).where(inIds(expenseSplits.expenseId, expIds));
    await db.delete(expenses).where(inIds(expenses.id, expIds));
  }
  await db.delete(settlements).where(eq(settlements.groupId, groupId));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  await db.delete(groups).where(eq(groups.id, groupId));
  await pruneOrphanPlaceholders(db);
}
