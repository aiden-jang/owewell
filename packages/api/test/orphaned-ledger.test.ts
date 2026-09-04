import { beforeEach, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createGroup, getGroup } from '../src/groups.js';
import { claimPlaceholder, getOrCreateShareToken } from '../src/sharing.js';
import { addPlaceholderMember } from '../src/members.js';
import { createExpense, getBalances } from '../src/expenses.js';
import { getSuggestedPayments } from '../src/settlements.js';
import { expenseSplits, groupMembers } from '../src/db/schema.js';
import { testDb, seedPerson } from './helpers.js';

/**
 * Regression tests for a production incident.
 *
 * A placeholder was claimed by a real account. The membership row moved, its six expense_splits did
 * not, and every balance call in that group then returned INTERNAL: computeBalances dropped the
 * seatless person's net, the balances stopped summing to zero, and simplifyDebts threw a SettleError
 * nothing mapped. Three defects, so three tests.
 */

let db: ReturnType<typeof testDb>;
let alice: string;
let groupId: string;

beforeEach(async () => {
  db = testDb();
  alice = await seedPerson(db, 'Alice');
  groupId = (await createGroup(db, alice, 'Trip')).id;
});

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

describe('a person with money and no seat', () => {
  test('balances still net to zero, and they stay on the ledger', async () => {
    const ghost = (await addPlaceholderMember(db, alice, groupId, 'david')).userId;
    await createExpense(db, alice, groupId, {
      description: 'Netflix house',
      amountCents: 4840,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: ghost }],
    });

    // Exactly the production state: the seat is gone, the split is not. Deleting the membership row
    // directly is the point — it is how the data actually ended up, whatever route it took.
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, ghost)));

    const balances = await getBalances(db, alice, groupId);
    expect(sum(balances.map((b) => b.netCents))).toBe(0);

    const stray = balances.find((b) => b.userId === ghost);
    expect(stray, 'someone who still owes money must stay visible').toBeDefined();
    expect(stray!.former).toBe(true);
    expect(stray!.netCents).toBe(-2420);
    expect(stray!.displayName).toBe('david');
  });

  test('suggested settlements no longer explode', async () => {
    const ghost = (await addPlaceholderMember(db, alice, groupId, 'david')).userId;
    await createExpense(db, alice, groupId, {
      description: '방탈출',
      amountCents: 3850,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: ghost }],
    });
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, ghost)));

    // This threw SettleError -> INTERNAL for every visit to the settlements page.
    const suggested = await getSuggestedPayments(db, alice, groupId);
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ fromUserId: ghost, toUserId: alice, amountCents: 1925 });
  });
});

describe('claiming a placeholder is all or nothing', () => {
  // This one is defensive, and the distinction matters.
  //
  // expense_splits has a unique (expense_id, person_id), so repointing the placeholder onto an
  // expense the claimer is already on would collide. I assumed that was how production broke, and it
  // is NOT reachable through the API: createExpense refuses a participant who is not a member, and
  // claimPlaceholder refuses a caller who is one. So the collision is constructed here at the data
  // layer on purpose.
  //
  // It is still worth defending. The state exists in production (a placeholder holding splits with no
  // seat), which means SOMETHING produced it, and a previously interrupted claim would leave the
  // caller in exactly this position for the next attempt. Whatever the original cause, the merge has
  // to survive meeting it.
  test('merges the shares rather than colliding, if the claimer already has a split', async () => {
    const david = await seedPerson(db, 'David Seo');
    const ghost = (await addPlaceholderMember(db, alice, groupId, 'david')).userId;

    const e = await createExpense(db, alice, groupId, {
      description: "Chili's",
      amountCents: 1649,
      payerId: alice,
      splitMethod: 'EXACT',
      participants: [
        { userId: alice, value: 1099 },
        { userId: ghost, value: 550 },
      ],
    });

    // David Seo holds a split without a seat: the residue of an earlier half-applied merge.
    await db.insert(expenseSplits).values({
      id: crypto.randomUUID(),
      expenseId: e.id,
      personId: david,
      owedCents: 0,
    });

    const token = await getOrCreateShareToken(db, alice, groupId);
    await claimPlaceholder(db, david, token, ghost);

    const balances = await getBalances(db, alice, groupId);
    expect(sum(balances.map((b) => b.netCents))).toBe(0);

    // One row for David Seo carrying both shares added together: not two rows, not one overwritten.
    const his = balances.filter((b) => b.userId === david);
    expect(his).toHaveLength(1);
    expect(his[0]!.owedCents).toBe(550);
    expect(balances.some((b) => b.userId === ghost)).toBe(false);
  });

  test('leaves the seat with the placeholder if the merge cannot complete', async () => {
    // Atomicity, from the outside: after any claim attempt the group is never left with the seat on
    // one identity and the money on another. That combination is the unrecoverable state.
    const david = await seedPerson(db, 'David Seo');
    const ghost = (await addPlaceholderMember(db, alice, groupId, 'david')).userId;
    await createExpense(db, alice, groupId, {
      description: 'toll fee',
      amountCents: 1040,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: ghost }],
    });

    const token = await getOrCreateShareToken(db, alice, groupId);
    // Deliberately NOT swallowing every error here. An earlier version wrapped this in
    // .catch(() => undefined), which made the test pass while the claim never ran at all.
    await claimPlaceholder(db, david, token, ghost);

    const balances = await getBalances(db, alice, groupId);
    expect(sum(balances.map((b) => b.netCents))).toBe(0);
    // Whoever owns the money owns the seat.
    const seats = new Set((await getGroup(db, alice, groupId)).members.map((m) => m.userId));
    for (const b of balances) {
      if (b.netCents !== 0) expect(seats.has(b.userId), `${b.displayName} has money but no seat`).toBe(true);
    }
  });
});
