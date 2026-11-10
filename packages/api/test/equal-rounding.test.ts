import { expect, test } from 'vitest';
import { createExpense, deleteExpense, updateExpense } from '../src/expenses.js';
import { createGroup } from '../src/groups.js';
import { addPlaceholderMember } from '../src/members.js';
import { seedPerson, testDb } from './helpers.js';

async function setup() {
  const db = testDb();
  const alice = await seedPerson(db, 'Alice');
  const { id: groupId } = await createGroup(db, alice, 'Trip');
  const { userId: bob } = await addPlaceholderMember(db, alice, groupId, 'Bob');
  const { userId: carl } = await addPlaceholderMember(db, alice, groupId, 'Carl');
  const everyone = [alice, bob, carl];
  const input = (amountCents: number, people = everyone) => ({
    description: 'Dinner',
    payerId: alice,
    splitMethod: 'EQUAL' as const,
    participants: people.map((userId) => ({ userId })),
    amountCents,
  });
  return { db, groupId, alice, bob, carl, input };
}

function extraCent(expense: { splits: { userId: string; owedCents: number }[] }) {
  const smallest = Math.min(...expense.splits.map((split) => split.owedCents));
  return expense.splits.filter((split) => split.owedCents > smallest).map((split) => split.userId);
}

test('different subsets contribute according to how far their shares rounded', async () => {
  const { db, groupId, alice, bob, carl, input } = await setup();
  const first = await createExpense(db, alice, groupId, input(101, [alice, bob]));
  expect(extraCent(first)).toEqual([alice]);
  const second = await createExpense(db, alice, groupId, input(100));
  expect(extraCent(second)).toEqual([bob]);
  // Carl is now the only person below his cumulative ideal share.
  const third = await createExpense(db, alice, groupId, input(100));
  expect(extraCent(third)).toEqual([carl]);
});

test('concurrent bills balance their cents and retrying one returns its original split', async () => {
  const { db, groupId, alice, bob, carl, input } = await setup();
  const save = (clientId: string) => createExpense(db, alice, groupId, { ...input(100), clientId });
  const bills = await Promise.all([save('one'), save('two'), save('three'), save('one')]);
  expect(bills[3].id).toBe(bills[0].id);
  expect(extraCent(bills[3])).toEqual(extraCent(bills[0]));
  expect(bills.slice(0, 3).flatMap(extraCent).sort()).toEqual([alice, bob, carl].sort());
  for (const bill of bills) expect(bill.splits.reduce((sum, split) => sum + split.owedCents, 0)).toBe(100);
});

test('deletion removes a bill from the history and editing its replacement preserves recipients', async () => {
  const { db, groupId, alice, bob, carl, input } = await setup();
  const deleted = await createExpense(db, alice, groupId, input(100));
  await deleteExpense(db, alice, groupId, deleted.id);
  const saved = await createExpense(db, alice, groupId, input(100));
  expect(extraCent(saved)).toEqual([alice]);

  const edited = await updateExpense(db, alice, groupId, saved.id, {
    ...input(100, [carl, bob, alice]),
    description: 'Dinner and dessert',
  });
  expect(extraCent(edited)).toEqual([alice]);
});
