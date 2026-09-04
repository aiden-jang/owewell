import { beforeEach, describe, expect, test } from 'vitest';
import {
  createGroup,
  deleteGroup,
  getGroup,
  getOrCreateShareToken,
  renameGroup,
  revokeShareToken,
  rotateShareToken,
  setGroupArchived,
} from '../src/groups.js';
import { addPlaceholderMember, removeMember, renameMember, setPaymentHandles } from '../src/members.js';
import {
  createExpense,
  createItemizedExpense,
  deleteExpense,
  getBalances,
  restoreExpense,
  updateExpense,
  updateItemizedExpense,
} from '../src/expenses.js';
import { listExpenses } from '../src/expenseList.js';
import {
  deleteSettlement,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from '../src/settlements.js';
import { testDb, seedPerson } from './helpers.js';

/**
 * A signed-in stranger must not reach a group they are not in.
 *
 * `requireMembership` is the guard behind 26 call sites across five modules, and it is the only
 * thing standing between "authenticated" and "authorised". Authentication is middleware and applies
 * to everything; authorisation is this, called by hand in each service function — so a new function
 * that forgets it is an ordinary omission with no compile error and no failing test.
 *
 * It throws NOT_FOUND rather than a distinct code on purpose: a stranger probing group ids learns
 * nothing about which ones exist.
 */

let owner: string;
let stranger: string;
let groupId: string;
let expenseId: string;
let settlementId: string;
let placeholderId: string;

beforeEach(async () => {
  const db = testDb();
  owner = await seedPerson(db, 'Alice');
  stranger = await seedPerson(db, 'Mallory');
  const group = await createGroup(db, owner, 'Tahoe');
  groupId = group.id;
  placeholderId = (await addPlaceholderMember(db, owner, groupId, 'Bob')).userId;

  const expense = await createExpense(db, owner, groupId, {
    description: 'Dinner',
    amountCents: 9_000,
    payerId: owner,
    splitMethod: 'EQUAL',
    participants: [{ userId: owner }, { userId: placeholderId }],
  });
  expenseId = expense.id;

  const settlement = await recordSettlement(db, owner, groupId, {
    fromUserId: placeholderId,
    toUserId: owner,
    amountCents: 1_000,
  });
  settlementId = settlement.id;
});

/** Every write a member can make. None of them may work for somebody outside the group. */
const writes: [string, (db: ReturnType<typeof testDb>) => Promise<unknown>][] = [
  ['renameGroup', (db) => renameGroup(db, stranger, groupId, 'Mine now')],
  ['setGroupArchived', (db) => setGroupArchived(db, stranger, groupId, true)],
  ['deleteGroup', (db) => deleteGroup(db, stranger, groupId)],
  ['getOrCreateShareToken', (db) => getOrCreateShareToken(db, stranger, groupId)],
  ['rotateShareToken', (db) => rotateShareToken(db, stranger, groupId)],
  ['revokeShareToken', (db) => revokeShareToken(db, stranger, groupId)],
  ['addPlaceholderMember', (db) => addPlaceholderMember(db, stranger, groupId, 'Eve')],
  ['renameMember', (db) => renameMember(db, stranger, groupId, placeholderId, 'Eve')],
  [
    'setPaymentHandles',
    (db) => setPaymentHandles(db, stranger, groupId, placeholderId, { venmoHandle: 'x' }),
  ],
  ['removeMember', (db) => removeMember(db, stranger, groupId, placeholderId)],
  [
    'createExpense',
    (db) =>
      createExpense(db, stranger, groupId, {
        description: 'Theirs',
        amountCents: 100,
        payerId: owner,
        splitMethod: 'EQUAL',
        participants: [{ userId: owner }],
      }),
  ],
  [
    'createItemizedExpense',
    (db) =>
      createItemizedExpense(db, stranger, groupId, {
        description: 'Theirs',
        payerId: owner,
        taxCents: 0,
        tipCents: 0,
        items: [{ name: 'Beer', amountCents: 100, participantIds: [owner] }],
      }),
  ],
  [
    'updateExpense',
    (db) =>
      updateExpense(db, stranger, groupId, expenseId, {
        description: 'Edited',
        amountCents: 100,
        payerId: owner,
        splitMethod: 'EQUAL',
        participants: [{ userId: owner }],
      }),
  ],
  [
    'updateItemizedExpense',
    (db) =>
      updateItemizedExpense(db, stranger, groupId, expenseId, {
        description: 'Edited',
        payerId: owner,
        taxCents: 0,
        tipCents: 0,
        items: [{ name: 'Beer', amountCents: 100, participantIds: [owner] }],
      }),
  ],
  ['deleteExpense', (db) => deleteExpense(db, stranger, groupId, expenseId)],
  ['restoreExpense', (db) => restoreExpense(db, stranger, groupId, expenseId)],
  [
    'recordSettlement',
    (db) =>
      recordSettlement(db, stranger, groupId, {
        fromUserId: owner,
        toUserId: placeholderId,
        amountCents: 100,
      }),
  ],
  ['deleteSettlement', (db) => deleteSettlement(db, stranger, groupId, settlementId)],
];

/** Reads leak just as much as writes: a debt graph names people and amounts. */
const reads: [string, (db: ReturnType<typeof testDb>) => Promise<unknown>][] = [
  ['getGroup', (db) => getGroup(db, stranger, groupId)],
  ['listExpenses', (db) => listExpenses(db, stranger, groupId)],
  ['getBalances', (db) => getBalances(db, stranger, groupId)],
  ['listSettlements', (db) => listSettlements(db, stranger, groupId)],
  ['getSuggestedPayments', (db) => getSuggestedPayments(db, stranger, groupId)],
];

describe('a signed-in stranger', () => {
  test.each(writes)('cannot %s', async (_name, call) => {
    await expect(call(testDb())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test.each(reads)('cannot %s', async (_name, call) => {
    await expect(call(testDb())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // The refusal must not confirm the group exists, or the id space becomes enumerable.
  test('gets the same answer for a group that does not exist', async () => {
    const db = testDb();
    const refusal = async (id: string): Promise<{ code: string; message: string }> =>
      getGroup(db, stranger, id).then(
        () => ({ code: 'NONE', message: 'it resolved' }),
        (e: { code: string; message: string }) => ({ code: e.code, message: e.message }),
      );
    const real = await refusal(groupId);
    const fake = await refusal('no-such-group');
    expect(real.code).toBe('NOT_FOUND');
    expect(fake).toEqual(real);
  });

  // The owner is unaffected: this is a guard, not a wall.
  test('while the owner can still do all of it', async () => {
    const db = testDb();
    await expect(getGroup(db, owner, groupId)).resolves.toBeTruthy();
    await expect(getBalances(db, owner, groupId)).resolves.toBeTruthy();
    await expect(renameGroup(db, owner, groupId, 'Tahoe again')).resolves.toBeTruthy();
  });
});
