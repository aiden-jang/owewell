import { beforeEach, describe, expect, test } from 'vitest';
import {
  createGroup,
  getGroup,
  setSettlementDeadline,
} from '../src/groups.js';
import {
  addPlaceholderMember,
} from '../src/members.js';
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
  /*
   * The deadline survives the final payment, on purpose.
   *
   * This used to null it, which covered exactly one of the several writes that can empty a ledger:
   * deleting the last expense, deleting an overpayment, and editing an expense down so it offsets a debt
   * all reach zero too, and all of them left the deadline nagging about money nobody owed. It also threw the owner's
   * finish line away, so a group that settled mid-trip and kept spending had nothing left to settle by.
   *
   * Whether the finish line currently applies is read from the balances instead. See `deadlineState`.
   */
  test('recording the final payment leaves the shared deadline for the next tab', async () => {
    // Alice pays 1000 split evenly: Bob owes Alice 500.
    await createExpense(db, alice, groupId, {
      description: 'Lunch',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    expect((await net())[bob]).toBe(-500);
    await setSettlementDeadline(db, alice, groupId, new Date('2026-08-20T22:00:00Z'));

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
    expect((await getGroup(db, alice, groupId)).settleBy).toEqual(new Date('2026-08-20T22:00:00Z'));
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

/*
 * Recording the same payment twice, which is what a replay from the outbox would otherwise do.
 *
 * A settlement is a fact about the past rather than a projection: "Bob handed Alice $30" stays true
 * however much the balances moved while it sat in a queue, so replaying it late is correct. Logging
 * it twice is not, and that is the only thing the client id has to prevent.
 */
describe('a payment that gets retried', () => {
  test('is logged once, however many times it is sent', async () => {
    const db = testDb();
    const alice = await seedPerson(db, 'Alice');
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 4_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });

    const pay = () =>
      recordSettlement(db, alice, group.id, {
        fromUserId: bob,
        toUserId: alice,
        amountCents: 2_000,
        clientId: 'outbox-pay-1',
      });

    const first = await pay();
    expect((await pay()).id).toBe(first.id);
    expect(await listSettlements(db, alice, group.id)).toHaveLength(1);
    // The thing that matters: Bob is square, not owed 2000 back.
    expect((await getBalances(db, alice, group.id)).find((b) => b.userId === bob)!.netCents).toBe(0);
  });

  test('a different payment with its own id is its own payment', async () => {
    const db = testDb();
    const alice = await seedPerson(db, 'Alice');
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await recordSettlement(db, alice, group.id, { fromUserId: bob, toUserId: alice, amountCents: 500, clientId: 'pay-a' });
    await recordSettlement(db, alice, group.id, { fromUserId: bob, toUserId: alice, amountCents: 500, clientId: 'pay-b' });
    expect(await listSettlements(db, alice, group.id)).toHaveLength(2);
  });
});
