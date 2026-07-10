import { beforeEach, describe, expect, test } from 'vitest';
import { addPlaceholderMember, createGroup } from '../src/groups.js';
import { createExpense, getBalances } from '../src/expenses.js';
import {
  SettlementError,
  deleteSettlement,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from '../src/settlements.js';
import { testDb, seedPerson } from './helpers.js';

let db: ReturnType<typeof testDb>;
let alice: string;
let bob: string;
let groupId: string;

beforeEach(async () => {
  db = testDb();
  alice = await seedPerson(db, 'Alice');
  const group = await createGroup(db, alice, 'Trip');
  groupId = group.id;
  bob = (await addPlaceholderMember(db, alice, groupId, 'Bob')).userId;
});

async function net(): Promise<Record<string, number>> {
  const balances = await getBalances(db, alice, groupId);
  return Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
}

describe('settlements', () => {
  test('recording a payment moves the balances toward zero', async () => {
    // Alice pays 1000 split evenly: Bob owes Alice 500.
    await createExpense(db, alice, groupId, {
      description: 'Lunch',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    expect((await net())[bob]).toBe(-500);

    const s = await recordSettlement(db, alice, groupId, {
      fromUserId: bob,
      toUserId: alice,
      amountCents: 500,
      method: 'cash',
    });
    expect(s.method).toBe('cash');
    const balances = await net();
    expect(balances[alice]).toBe(0);
    expect(balances[bob]).toBe(0);
    expect(await listSettlements(db, alice, groupId)).toHaveLength(1);
  });

  test('suggested payments settle the debt in one transfer', async () => {
    await createExpense(db, alice, groupId, {
      description: 'Lunch',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    const suggested = await getSuggestedPayments(db, alice, groupId);
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ fromUserId: bob, toUserId: alice, amountCents: 500 });
  });

  test('a payment needs two different people', async () => {
    await expect(
      recordSettlement(db, alice, groupId, { fromUserId: alice, toUserId: alice, amountCents: 100 }),
    ).rejects.toMatchObject({ code: 'SAME_PARTY' });
  });

  test('both parties must be members', async () => {
    const outsider = await seedPerson(db, 'Nate');
    await expect(
      recordSettlement(db, alice, groupId, { fromUserId: alice, toUserId: outsider, amountCents: 100 }),
    ).rejects.toMatchObject({ code: 'INVALID_PARTICIPANT' });
  });

  test('deleteSettlement removes it and restores balances', async () => {
    await createExpense(db, alice, groupId, {
      description: 'Lunch',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    const s = await recordSettlement(db, alice, groupId, {
      fromUserId: bob,
      toUserId: alice,
      amountCents: 500,
    });
    expect((await net())[bob]).toBe(0);
    await deleteSettlement(db, alice, groupId, s.id);
    expect((await net())[bob]).toBe(-500);
    await expect(deleteSettlement(db, alice, groupId, s.id)).rejects.toBeInstanceOf(SettlementError);
  });
});
