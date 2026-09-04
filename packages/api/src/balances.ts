import { and, eq, inArray, isNull } from 'drizzle-orm';
import { computeItemizedPayers } from '@owewell/shared';
import type { DB } from './db/client.js';
import { expenseItems, expenseSplits, expenses, groupMembers, people, settlements } from './db/schema.js';
import { requireMembership } from './groups.js';

/*
 * Reading the ledger, kept apart from writing it.
 *
 * Everything else in expenses.ts changes a row; this only adds up what is already there. It is
 * also the half carrying an invariant: what it returns has to net to zero, because simplifyDebts
 * throws on a set that does not, so the settle-up screen would stop working rather than be
 * slightly wrong. test/ledger-nets-to-zero.test.ts is what holds that.
 */

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
