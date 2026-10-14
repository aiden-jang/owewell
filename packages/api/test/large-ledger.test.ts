import { beforeEach, expect, test } from 'vitest';
import {
  groups,
  groupMembers,
  people,
  expenses,
  expenseItems,
  expenseItemShares,
  expenseSplits,
} from '../src/db/schema.js';
import { createGroup, listGroups } from '../src/groups.js';
import { addPlaceholderMember } from '../src/members.js';
import { createExpense } from '../src/expenses.js';
import { getBalances } from '../src/balances.js';
import { listExpenses } from '../src/expenseList.js';
import { deleteGroup } from '../src/groups.js';
import { eq } from 'drizzle-orm';
import { inIds } from '../src/db/ids.js';
import { insertRows } from '../src/db/rows.js';
import { seedPerson, testDb } from './helpers.js';

let alice: string;
beforeEach(async () => {
  alice = await seedPerson(testDb(), 'Alice');
});

test('large group histories retain membership and exact summary balances', async () => {
  const db = testDb();
  const ids = Array.from({ length: 120 }, () => crypto.randomUUID());
  for (let offset = 0; offset < ids.length; offset += 20) {
    const chunk = ids.slice(offset, offset + 20);
    await db.batch([
      db.insert(groups).values(chunk.map((id) => ({ id, name: 'Past trip', createdById: alice }))),
      db
        .insert(groupMembers)
        .values(
          chunk.map((groupId) => ({ id: crypto.randomUUID(), groupId, personId: alice, role: 'OWNER' })),
        ),
    ]);
  }
  const current = await createGroup(db, alice, 'Current trip');
  const bob = (await addPlaceholderMember(db, alice, current.id, 'Bob')).userId;
  await createExpense(db, alice, current.id, {
    description: 'Dinner',
    payerId: alice,
    amountCents: 501,
    splitMethod: 'EXACT',
    participants: [
      { userId: alice, value: 100 },
      { userId: bob, value: 401 },
    ],
  });
  const otherOwner = await seedPerson(db, 'Other owner');
  const privateGroup = await createGroup(db, otherOwner, 'Not Alice’s');
  const summary = await listGroups(db, alice);
  expect(summary).toHaveLength(121);
  expect(summary.map((group) => group.id)).not.toContain(privateGroup.id);
  expect(summary.find((group) => group.id === current.id)).toMatchObject({
    memberCount: 2,
    totalSpentCents: 501,
    netCents: 401,
    totalUnsettledCents: 401,
    isOwner: true,
  });
});

test('an expense can split across a large roster without losing cents', async () => {
  const db = testDb();
  const group = await createGroup(db, alice, 'Big dinner');
  const guests = Array.from({ length: 39 }, () => crypto.randomUUID());
  for (let offset = 0; offset < guests.length; offset += 10) {
    const chunk = guests.slice(offset, offset + 10);
    await db.batch([
      db.insert(people).values(chunk.map((id) => ({ id, displayName: 'Guest', isPlaceholder: true }))),
      db
        .insert(groupMembers)
        .values(
          chunk.map((personId) => ({ id: crypto.randomUUID(), groupId: group.id, personId, role: 'MEMBER' })),
        ),
    ]);
  }
  const expense = await createExpense(db, alice, group.id, {
    description: 'Dinner',
    payerId: alice,
    amountCents: 4000,
    splitMethod: 'EQUAL',
    participants: [alice, ...guests].map((userId) => ({ userId })),
  });
  expect(expense.splits).toHaveLength(40);
  expect(expense.splits.reduce((sum, share) => sum + share.owedCents, 0)).toBe(4000);
  const balances = await getBalances(db, alice, group.id);
  expect(balances.reduce((sum, person) => sum + person.netCents, 0)).toBe(0);
  expect(balances.find((person) => person.userId === alice)?.netCents).toBe(3900);
});

test('large itemized receipts remain readable and can be deleted with their group', async () => {
  const db = testDb();
  const group = await createGroup(db, alice, 'Long receipt');
  const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
  const expenseId = crypto.randomUUID();
  await db.insert(expenses).values({
    id: expenseId,
    groupId: group.id,
    createdById: alice,
    payerId: alice,
    description: 'Receipt',
    amountCents: 11000,
    splitMethod: 'ITEMIZED',
    taxCents: 0,
    tipCents: 0,
  });
  const items = Array.from({ length: 110 }, () => crypto.randomUUID());
  for (let offset = 0; offset < items.length; offset += 10) {
    const chunk = items.slice(offset, offset + 10);
    await db.batch([
      db
        .insert(expenseItems)
        .values(chunk.map((id) => ({ id, expenseId, name: 'Item', amountCents: 100, payerId: alice }))),
      db
        .insert(expenseItemShares)
        .values(
          chunk.flatMap((itemId) =>
            [alice, bob].map((personId) => ({ id: crypto.randomUUID(), itemId, personId })),
          ),
        ),
    ]);
  }
  await db
    .insert(expenseSplits)
    .values(
      [alice, bob].map((personId) => ({ id: crypto.randomUUID(), expenseId, personId, owedCents: 5500 })),
    );
  const listed = await listExpenses(db, alice, group.id);
  expect(listed[0]?.items).toHaveLength(110);
  const balances = await getBalances(db, alice, group.id);
  expect(balances.find((person) => person.userId === alice)?.netCents).toBe(5500);
  expect(balances.reduce((sum, person) => sum + person.netCents, 0)).toBe(0);
  await deleteGroup(db, alice, group.id);
  expect(await db.select().from(expenseItemShares).all()).toEqual([]);
});

test('ID collections preserve empty filters, quoted values and database subqueries', async () => {
  const db = testDb();
  const id = `person'); DELETE FROM people; --`;
  await db.insert(people).values({ id, displayName: 'Quoted ID' });
  expect(
    (
      await db
        .select()
        .from(people)
        .where(inIds(people.id, [id]))
        .all()
    ).map((row) => row.id),
  ).toEqual([id]);
  expect(await db.select().from(people).where(inIds(people.id, [])).all()).toEqual([]);
  const selected = db.select({ id: people.id }).from(people).where(eq(people.id, id));
  expect(
    (await db.select().from(people).where(inIds(people.id, selected)).all()).map((row) => row.id),
  ).toEqual([id]);
});

test('a conflict rolls back every bounded insert in the batch', async () => {
  const db = testDb();
  const rows = Array.from({ length: 30 }, () => ({ id: crypto.randomUUID(), displayName: 'Batch guest' }));
  rows[29]!.id = rows[0]!.id;
  await expect(insertRows(db, people, rows)).rejects.toThrow(/UNIQUE constraint failed/);
  expect(
    await db
      .select()
      .from(people)
      .where(
        inIds(
          people.id,
          rows.map((row) => row.id),
        ),
      )
      .all(),
  ).toEqual([]);
});
