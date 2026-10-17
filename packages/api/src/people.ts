import { and, eq, isNull, notInArray } from 'drizzle-orm';
import type { AuthUser } from '@aidenjang/auth-client';
import type { DB } from './db/client.js';
import {
  expenseItemShares,
  expenseItems,
  expenseSplits,
  expenses,
  groupMembers,
  people,
  settlements,
} from './db/schema.js';

export interface Person {
  id: string;
  displayName: string;
  isPlaceholder: boolean;
}

/**
 * Resolve a shared-auth account to its owewell-local person, creating it on first sight.
 * Keeps displayName fresh from auth. owewell keys all its data on person.id, never the auth id.
 */
export async function getOrCreatePerson(db: DB, authUser: AuthUser): Promise<Person> {
  const existing = await db
    .select({ id: people.id, displayName: people.displayName, isPlaceholder: people.isPlaceholder })
    .from(people)
    .where(eq(people.authUserId, authUser.id))
    .get();
  if (existing) {
    if (existing.displayName !== authUser.displayName) {
      await db.update(people).set({ displayName: authUser.displayName }).where(eq(people.id, existing.id));
      existing.displayName = authUser.displayName;
    }
    return existing;
  }
  // Idempotent create.
  //
  // This runs in middleware on every /owewell/* request, and auth_user_id is UNIQUE. A first sign-in
  // usually means several requests arriving at once (the SPA loads groups, the group, and opens the
  // socket together), so a plain read-then-insert has all of them find nothing and all of them try to
  // insert. One wins; the rest hit the unique constraint, which was uncaught and surfaced as
  // {"error":"INTERNAL"} on a brand-new user's very first page load.
  //
  // onConflictDoNothing makes the insert safe to lose, then we read back whichever row won.
  const id = crypto.randomUUID();
  await db
    .insert(people)
    .values({ id, authUserId: authUser.id, displayName: authUser.displayName })
    .onConflictDoNothing({ target: people.authUserId });

  const row = await db
    .select({ id: people.id, displayName: people.displayName, isPlaceholder: people.isPlaceholder })
    .from(people)
    .where(eq(people.authUserId, authUser.id))
    .get();
  // Unreachable in practice: either our insert landed or someone else's did.
  if (!row) throw new Error(`Could not resolve a person for auth user ${authUser.id}`);
  return row;
}

/** Delete only unreferenced placeholders. Retained ledger history still owns its people. */
export async function pruneOrphanPlaceholders(db: DB): Promise<void> {
  const referenced = new Set<string>();
  const collect = (rows: { id: string | null }[]): void => {
    for (const r of rows) if (r.id) referenced.add(r.id);
  };
  const [members, payers, splits, itemPayers, shares, settleFrom, settleTo] = await Promise.all([
    db.selectDistinct({ id: groupMembers.personId }).from(groupMembers),
    db.selectDistinct({ id: expenses.payerId }).from(expenses),
    db.selectDistinct({ id: expenseSplits.personId }).from(expenseSplits),
    db.selectDistinct({ id: expenseItems.payerId }).from(expenseItems),
    db.selectDistinct({ id: expenseItemShares.personId }).from(expenseItemShares),
    db.selectDistinct({ id: settlements.fromPersonId }).from(settlements),
    db.selectDistinct({ id: settlements.toPersonId }).from(settlements),
  ]);
  [members, payers, splits, itemPayers, shares, settleFrom, settleTo].forEach(collect);

  const keepIds = [...referenced];
  const base = and(eq(people.isPlaceholder, true));
  await db
    .delete(people)
    .where(keepIds.length ? and(base, notInArray(people.id, keepIds)) : and(base, isNull(people.authUserId)));
}
