import { beforeEach, describe, expect, test } from 'vitest';
import {
  addPlaceholderMember,
  createGroup,
  getGroup,
  setSettlementDeadline,
} from '../src/groups.js';
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
   * deleting the last expense, deleting an overpayment, and a recurring bill that offsets a debt all reach
   * zero too, and all of them left the deadline nagging about money nobody owed. It also threw the owner's
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
