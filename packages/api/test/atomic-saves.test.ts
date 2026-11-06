import { env } from 'cloudflare:test';
import { afterEach, expect, test } from 'vitest';
import { createExpense, updateExpense } from '../src/expenses.js';
import { createItemizedExpense } from '../src/itemizedExpenses.js';
import { listExpenses } from '../src/expenseList.js';
import { createGroup, listGroups } from '../src/groups.js';
import { createQuickSplit } from '../src/quicksplit.js';
import { seedPerson, testDb } from './helpers.js';

const quickSplit = {
  clientId: 'one-off-save',
  people: [{ name: 'Alex', isYou: true, isPayer: true }, { name: 'Sam' }],
  items: [
    { description: 'Dinner', amountCents: 4000, splitMethod: 'EQUAL' as const },
    { description: 'Movie', amountCents: 2000, splitMethod: 'EQUAL' as const },
  ],
};

afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_movie').run();
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_shares').run();
});

test('a quick split retry returns the same complete group for that account', async () => {
  const db = testDb();
  const alex = await seedPerson(db, 'Alex');
  const sam = await seedPerson(db, 'Sam');
  const [first, retry] = await Promise.all([
    createQuickSplit(db, alex, quickSplit),
    createQuickSplit(db, alex, quickSplit),
  ]);
  expect(retry).toEqual(first);
  expect(await listGroups(db, alex)).toHaveLength(1);
  expect(await listExpenses(db, alex, first.groupId)).toHaveLength(2);
  expect(await createQuickSplit(db, sam, quickSplit)).not.toEqual(first);
});

test('a full 50-person, 50-item quick split stays within the batch parameter budget', async () => {
  const db = testDb();
  const alex = await seedPerson(db, 'Alex');
  const { groupId } = await createQuickSplit(db, alex, {
    people: [
      quickSplit.people[0]!,
      ...Array.from({ length: 49 }, (_, index) => ({ name: `Guest ${index + 1}` })),
    ],
    items: Array.from({ length: 50 }, (_, index) => ({
      description: `Item ${index + 1}`,
      amountCents: 4001,
      splitMethod: 'EQUAL',
    })),
  });
  const expenses = await listExpenses(db, alex, groupId);
  expect(expenses).toHaveLength(50);
  for (const expense of expenses) {
    expect(expense.splits).toHaveLength(50);
    expect(expense.splits.reduce((sum, share) => sum + share.owedCents, 0)).toBe(4001);
  }
});

test('a failed quick split rolls back the group, members, and expenses', async () => {
  const db = testDb();
  const alex = await seedPerson(db, 'Alex');
  await env.DB.prepare(
    "CREATE TRIGGER fail_movie BEFORE INSERT ON expenses WHEN NEW.description = 'Movie' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  await expect(createQuickSplit(db, alex, quickSplit)).rejects.toThrow();
  expect(await listGroups(db, alex)).toEqual([]);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM people').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM expenses').first('n')).toBe(0);
});

for (const kind of ['expense', 'receipt'] as const) {
  test(`concurrent ${kind} retries return one saved expense and failed splits roll back`, async () => {
    const db = testDb();
    const alex = await seedPerson(db, 'Alex');
    const { id: group } = await createGroup(db, alex, 'Trip');
    const save = (clientId: string) =>
      kind === 'expense'
        ? createExpense(db, alex, group, {
            clientId,
            description: 'Dinner',
            payerId: alex,
            amountCents: 4000,
            splitMethod: 'EQUAL',
            participants: [{ userId: alex }],
          })
        : createItemizedExpense(db, alex, group, {
            clientId,
            description: 'Dinner',
            payerId: alex,
            taxCents: 0,
            tipCents: 0,
            items: [{ name: 'Dinner', amountCents: 4000, participantIds: [alex] }],
          });
    const [first, retry] = await Promise.all([save('same-save'), save('same-save')]);
    expect(retry).toEqual(first);
    await env.DB.prepare(
      'CREATE TRIGGER fail_shares BEFORE INSERT ON ' +
        (kind === 'expense' ? 'expense_splits' : 'expense_item_shares') +
        " BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    ).run();
    await expect(save('new-attempt')).rejects.toThrow();
    const expenses = await listExpenses(db, alex, group);
    expect(expenses.map(({ id }) => id)).toEqual([first.id]);
    expect(expenses[0]?.splits).toMatchObject([{ userId: alex, owedCents: 4000 }]);
  });
}

test('a partial edit rolls back and competing edits cannot both win', async () => {
  const db = testDb();
  const alex = await seedPerson(db, 'Alex');
  const { id: group } = await createGroup(db, alex, 'Trip');
  const input = {
    description: 'Dinner',
    payerId: alex,
    amountCents: 4000,
    splitMethod: 'EQUAL' as const,
    participants: [{ userId: alex }],
  };
  const expense = await createExpense(db, alex, group, input);
  const edit = (amountCents: number) =>
    updateExpense(db, alex, group, expense.id, {
      ...input,
      amountCents,
      expectedVersion: 1,
    });
  await env.DB.prepare(
    "CREATE TRIGGER fail_shares BEFORE INSERT ON expense_splits BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  ).run();
  await expect(edit(6000)).rejects.toThrow();
  expect((await listExpenses(db, alex, group))[0]).toMatchObject({ amountCents: 4000, version: 1 });
  await env.DB.prepare('DROP TRIGGER fail_shares').run();
  const results = await Promise.allSettled([edit(5000), edit(6000)]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
  const [saved] = await listExpenses(db, alex, group);
  expect(saved?.splits[0]?.owedCents).toBe(saved?.amountCents);
  expect(saved?.version).toBe(2);
});
