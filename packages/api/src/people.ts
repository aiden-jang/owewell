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
  const person: Person = {
    id: crypto.randomUUID(),
    displayName: authUser.displayName,
    isPlaceholder: false,
  };
  await db.insert(people).values({ id: person.id, authUserId: authUser.id, displayName: person.displayName });
  return person;
}

/**
 * Delete placeholder people who are no longer referenced anywhere (orphaned by a removal or a
 * group delete). "Referenced" means a current group membership OR any surviving expense,
 * split, item, item-share, or settlement row. Removing a settled member keeps their history,
 * so their placeholder is still referenced and must survive — deleting it would break foreign
 * keys. Only truly dangling placeholders get cleaned up.
 */
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
  await db.delete(people).where(keepIds.length ? and(base, notInArray(people.id, keepIds)) : and(base, isNull(people.authUserId)));
}
