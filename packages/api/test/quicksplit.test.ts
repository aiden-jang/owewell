import { beforeEach, describe, expect, test } from 'vitest';
import { getGroup } from '../src/groups.js';
import { getBalances } from '../src/expenses.js';
import { listExpenses } from '../src/expenseList.js';
import { QuickSplitError, createQuickSplit } from '../src/quicksplit.js';
import { testDb, seedPerson } from './helpers.js';

let db: ReturnType<typeof testDb>;
let alice: string;

beforeEach(async () => {
  db = testDb();
  alice = await seedPerson(db, 'Alice');
});

describe('quick-split', () => {
  test('creates an owned group, placeholders, and one expense', async () => {
    const { groupId } = await createQuickSplit(db, alice, {
      people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }, { name: 'Kai' }],
      items: [{ description: 'Tacos', amountCents: 3000, splitMethod: 'EQUAL' }],
    });

    const group = await getGroup(db, alice, groupId);
    expect(group.name).toBe('Tacos');
    expect(group.members).toHaveLength(3);
    expect(group.members.find((m) => m.userId === alice)?.role).toBe('OWNER');

    const expenses = await listExpenses(db, alice, groupId);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]!.amountCents).toBe(3000);

    const balances = await getBalances(db, alice, groupId);
    expect(balances.find((b) => b.userId === alice)?.netCents).toBe(2000);
    expect(balances.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  test('routes each item to its own payer', async () => {
    // You paid Pizza (20, split evenly), Sam paid Drinks (10, split evenly).
    const { groupId } = await createQuickSplit(db, alice, {
      people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }],
      items: [
        { description: 'Pizza', amountCents: 2000, splitMethod: 'EQUAL', payerIndex: 0 },
        { description: 'Drinks', amountCents: 1000, splitMethod: 'EQUAL', payerIndex: 1 },
      ],
    });
    const group = await getGroup(db, alice, groupId);
    const sam = group.members.find((m) => m.userId !== alice)!.userId;
    const net = Object.fromEntries(
      (await getBalances(db, alice, groupId)).map((b) => [b.userId, b.netCents]),
    );
    expect(net[alice]).toBe(500); // paid 2000, owes 1500
    expect(net[sam]).toBe(-500); // paid 1000, owes 1500
  });

  test('rejects an out-of-range item payer', async () => {
    await expect(
      createQuickSplit(db, alice, {
        people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }],
        items: [{ description: 'X', amountCents: 500, splitMethod: 'EQUAL', payerIndex: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYER' });
  });

  test('creates one expense per item and nets them across a single payer', async () => {
    // You paid everything: Dinner 30 equally (3 ways) + Drinks 20 all to Sam (exact).
    const { groupId } = await createQuickSplit(db, alice, {
      people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }, { name: 'Kai' }],
      items: [
        { description: 'Dinner', amountCents: 3000, splitMethod: 'EQUAL' },
        { description: 'Drinks', amountCents: 2000, splitMethod: 'EXACT', values: [0, 2000, 0] },
      ],
    });

    const group = await getGroup(db, alice, groupId);
    expect(group.name).toBe('Dinner'); // group name comes from the first item

    const expenses = await listExpenses(db, alice, groupId);
    expect(expenses).toHaveLength(2);

    // You are owed both expenses' non-payer shares: Dinner (2000) + Drinks (2000) = 4000.
    const balances = await getBalances(db, alice, groupId);
    expect(balances.find((b) => b.userId === alice)?.netCents).toBe(4000);
    // Sam owes their dinner third (1000) + all the drinks (2000) = 3000.
    const sam = group.members.find((m) => m.displayName === 'Sam')?.userId;
    expect(balances.find((b) => b.userId === sam)?.netCents).toBe(-3000);
    expect(balances.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  test('requires exactly one payer', async () => {
    await expect(
      createQuickSplit(db, alice, {
        people: [{ name: 'You', isYou: true }, { name: 'Sam' }],
        items: [{ description: 'X', amountCents: 1000, splitMethod: 'EQUAL' }],
      }),
    ).rejects.toMatchObject({ code: 'NO_PAYER' });
  });

  test('rejects more than one "you"', async () => {
    await expect(
      createQuickSplit(db, alice, {
        people: [
          { name: 'You', isPayer: true, isYou: true },
          { name: 'Also you', isYou: true },
        ],
        items: [{ description: 'X', amountCents: 1000, splitMethod: 'EQUAL' }],
      }),
    ).rejects.toBeInstanceOf(QuickSplitError);
  });

  test('rejects when there are no items', async () => {
    await expect(
      createQuickSplit(db, alice, {
        people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }],
        items: [],
      }),
    ).rejects.toMatchObject({ code: 'NO_ITEMS' });
  });

  test('rejects an item whose math is invalid', async () => {
    await expect(
      createQuickSplit(db, alice, {
        people: [{ name: 'You', isPayer: true, isYou: true }, { name: 'Sam' }],
        items: [{ description: 'X', amountCents: 1000, splitMethod: 'PERCENT', values: [3000, 3000] }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SPLIT' });
  });
});
