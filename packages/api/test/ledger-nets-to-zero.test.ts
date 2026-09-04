import { beforeEach, describe, expect, test } from 'vitest';
import { createGroup } from '../src/groups.js';
import { addPlaceholderMember } from '../src/members.js';
import { createExpense, createItemizedExpense, deleteExpense, getBalances } from '../src/expenses.js';
import { recordSettlement } from '../src/settlements.js';
import { testDb, seedPerson } from './helpers.js';

/*
 * Every split function conserves money on its own and each has a property test saying so. This is
 * the invariant those cannot see: whether the assembled ledger still nets to zero once expenses,
 * itemized receipts whose credits are recomputed on every read, settlements and deletions are all
 * mixed together in one group.
 *
 * It matters more than being off by a cent sounds. simplifyDebts throws on a set that does not net
 * to zero, so the settle-up screen would stop working entirely rather than show a slightly wrong
 * number.
 */

/** Seeded so a failure names a run that can be replayed rather than one that happened once. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

let alice: string;
beforeEach(async () => {
  alice = await seedPerson(testDb(), 'Alice');
});

describe('the assembled ledger', () => {
  test('nets to zero through any mix of expenses, receipts, settlements and deletions', async () => {
    const db = testDb();

    for (let run = 0; run < 12; run++) {
      const random = rng(run + 1);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
      const cents = (max: number): number => 1 + Math.floor(random() * max);

      const group = await createGroup(db, alice, `Run ${run}`);
      const members = [alice];
      for (const name of ['Bob', 'Carol', 'Dan']) {
        members.push((await addPlaceholderMember(db, alice, group.id, name)).userId);
      }

      const created: string[] = [];
      let settled = false;

      for (let step = 0; step < 8; step++) {
        const move = Math.floor(random() * 10);

        if (move < 4) {
          const method = pick(['EQUAL', 'SHARES', 'EXACT'] as const);
          const total = cents(50_000);
          const who = members.filter(() => random() > 0.3);
          const participants = (who.length > 0 ? who : [alice]).map((userId) => ({ userId }));
          const expense = await createExpense(db, alice, group.id, {
            description: `e${step}`,
            amountCents: total,
            payerId: pick(members),
            splitMethod: method,
            participants:
              method === 'EQUAL'
                ? participants
                : method === 'SHARES'
                  ? participants.map((p) => ({ ...p, value: cents(5) }))
                  : shareOutExactly(total, participants),
          });
          created.push(expense.id);
        } else if (move < 7) {
          const items = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
            name: 'item',
            amountCents: cents(9_000),
            participantIds: members.filter(() => random() > 0.4),
            payerId: pick(members),
          })).filter((i) => i.participantIds.length > 0);
          if (items.length === 0) continue;
          const expense = await createItemizedExpense(db, alice, group.id, {
            description: `r${step}`,
            payerId: pick(members),
            items,
            taxCents: Math.floor(random() * 800),
            tipCents: Math.floor(random() * 1500),
          });
          created.push(expense.id);
        } else if (move < 9 && created.length > 0 && !settled) {
          const doomed = pick(created);
          await deleteExpense(db, alice, group.id, doomed);
          created.splice(created.indexOf(doomed), 1);
        } else {
          const from = pick(members);
          const to = pick(members.filter((m) => m !== from));
          await recordSettlement(db, alice, group.id, {
            fromUserId: from,
            toUserId: to,
            amountCents: cents(20_000),
          });
          // A recorded payment locks the group's history: no more edits or deletions.
          settled = true;
        }

        const balances = await getBalances(db, alice, group.id);
        const net = balances.reduce((sum, b) => sum + b.netCents, 0);
        expect(net, `run ${run} step ${step} left ${net} cents unaccounted for`).toBe(0);
      }
    }
  });
});

/** EXACT amounts have to add up to the total, so hand out the remainder rather than rounding. */
function shareOutExactly(
  total: number,
  participants: readonly { userId: string }[],
): { userId: string; value: number }[] {
  const each = Math.floor(total / participants.length);
  return participants.map((p, i) => ({
    userId: p.userId,
    value: i === 0 ? total - each * (participants.length - 1) : each,
  }));
}
