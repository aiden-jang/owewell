import { beforeEach, describe, expect, test } from 'vitest';
import { addPlaceholderMember, createGroup } from '../src/groups.js';
import { recordSettlement } from '../src/settlements.js';
import {
  ExpenseError,
  createExpense,
  createItemizedExpense,
  deleteExpense,
  getBalances,
  listExpenses,
  updateExpense,
  updateItemizedExpense,
} from '../src/expenses.js';
import { testDb, seedPerson } from './helpers.js';

let db: ReturnType<typeof testDb>;
let alice: string;
let groupId: string;
let bob: string;
let carl: string;

beforeEach(async () => {
  db = testDb();
  alice = await seedPerson(db, 'Alice');
  const group = await createGroup(db, alice, 'Trip');
  groupId = group.id;
  bob = (await addPlaceholderMember(db, alice, groupId, 'Bob')).userId;
  carl = (await addPlaceholderMember(db, alice, groupId, 'Carl')).userId;
});

function owed(splits: { userId: string; owedCents: number }[]): Record<string, number> {
  return Object.fromEntries(splits.map((s) => [s.userId, s.owedCents]));
}
async function net(): Promise<Record<string, number>> {
  const balances = await getBalances(db, alice, groupId);
  return Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
}

describe('expenses — split methods', () => {
  test('EQUAL splits evenly', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 3000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    expect(owed(e.splits)).toEqual({ [alice]: 1000, [bob]: 1000, [carl]: 1000 });
  });

  test('EXACT uses the given cents', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Cab',
      amountCents: 1000,
      payerId: bob,
      splitMethod: 'EXACT',
      participants: [
        { userId: alice, value: 700 },
        { userId: carl, value: 300 },
      ],
    });
    expect(owed(e.splits)).toEqual({ [alice]: 700, [carl]: 300 });
  });

  test('PERCENT uses basis points', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Hotel',
      amountCents: 2000,
      payerId: carl,
      splitMethod: 'PERCENT',
      participants: [
        { userId: alice, value: 5000 },
        { userId: bob, value: 5000 },
      ],
    });
    expect(owed(e.splits)).toEqual({ [alice]: 1000, [bob]: 1000 });
  });

  test('stores the category and returns null when omitted', async () => {
    await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
      category: 'food',
    });
    await createExpense(db, alice, groupId, {
      description: 'Mystery charge',
      amountCents: 500,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }],
    });
    const byDesc = Object.fromEntries(
      (await listExpenses(db, alice, groupId)).map((e) => [e.description, e.category]),
    );
    expect(byDesc['Dinner']).toBe('food');
    expect(byDesc['Mystery charge']).toBeNull();
  });

  test('SHARES splits by weight', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Gas',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'SHARES',
      participants: [
        { userId: alice, value: 1 },
        { userId: bob, value: 3 },
      ],
    });
    expect(owed(e.splits)).toEqual({ [alice]: 250, [bob]: 750 });
  });
});

describe('expenses — validation', () => {
  test('payer must be a member', async () => {
    const outsider = await seedPerson(db, 'Nate');
    await expect(
      createExpense(db, alice, groupId, {
        description: 'X',
        amountCents: 100,
        payerId: outsider,
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYER' });
  });

  test('every participant must be a member', async () => {
    const outsider = await seedPerson(db, 'Nate');
    await expect(
      createExpense(db, alice, groupId, {
        description: 'X',
        amountCents: 100,
        payerId: alice,
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }, { userId: outsider }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARTICIPANT' });
  });

  test('EXACT that does not sum is INVALID_SPLIT', async () => {
    await expect(
      createExpense(db, alice, groupId, {
        description: 'X',
        amountCents: 1000,
        payerId: alice,
        splitMethod: 'EXACT',
        participants: [
          { userId: alice, value: 400 },
          { userId: bob, value: 400 },
        ],
      }),
    ).rejects.toBeInstanceOf(ExpenseError);
  });
});

describe('expenses — itemized, balances, delete', () => {
  test('itemized splits items + tax/tip and balances sum to zero', async () => {
    const e = await createItemizedExpense(db, alice, groupId, {
      description: 'Restaurant',
      payerId: bob,
      taxCents: 300,
      tipCents: 200,
      items: [
        { name: 'Pizza', amountCents: 1800, participantIds: [alice, bob] },
        { name: 'Salad', amountCents: 1200, participantIds: [carl] },
      ],
    });
    expect(e.splitMethod).toBe('ITEMIZED');
    expect(e.amountCents).toBe(1800 + 1200 + 300 + 200);
    const total = e.splits.reduce((sum, s) => sum + s.owedCents, 0);
    expect(total).toBe(e.amountCents);
    expect(Object.values(await net()).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('per-item payers credit each item to its own payer', async () => {
    await createItemizedExpense(db, alice, groupId, {
      description: 'Split tabs',
      payerId: alice,
      taxCents: 0,
      tipCents: 0,
      items: [
        { name: 'Pizza', amountCents: 2000, participantIds: [alice, bob], payerId: alice },
        { name: 'Drinks', amountCents: 1000, participantIds: [alice, bob], payerId: bob },
      ],
    });
    // owed: alice 1500, bob 1500. paid: alice 2000, bob 1000.
    const balances = await net();
    expect(balances[alice]).toBe(500);
    expect(balances[bob]).toBe(-500);
    expect(balances[carl]).toBe(0);
    expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('balances report each member paid and share, and settlements leave them alone', async () => {
    // Alice pays 3000 split evenly among three: each share 1000.
    await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 3000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    const byId = Object.fromEntries((await getBalances(db, alice, groupId)).map((b) => [b.userId, b]));
    expect(byId[alice]).toMatchObject({ paidCents: 3000, owedCents: 1000, netCents: 2000 });
    expect(byId[bob]).toMatchObject({ paidCents: 0, owedCents: 1000, netCents: -1000 });
    expect(byId[carl]).toMatchObject({ paidCents: 0, owedCents: 1000, netCents: -1000 });

    // A settlement moves the net but is not spending, so paid/share stay put.
    await recordSettlement(db, alice, groupId, { fromUserId: bob, toUserId: alice, amountCents: 1000 });
    const after = Object.fromEntries((await getBalances(db, alice, groupId)).map((b) => [b.userId, b]));
    expect(after[bob]).toMatchObject({ paidCents: 0, owedCents: 1000, netCents: 0 });
    expect(after[alice]).toMatchObject({ paidCents: 3000, owedCents: 1000, netCents: 1000 });
  });

  test('an item with no payer falls back to the expense payer', async () => {
    await createItemizedExpense(db, alice, groupId, {
      description: 'Mixed',
      payerId: bob,
      taxCents: 0,
      tipCents: 0,
      items: [
        { name: 'A', amountCents: 1000, participantIds: [alice], payerId: alice },
        { name: 'B', amountCents: 1000, participantIds: [carl] }, // no payer -> expense payer (bob)
      ],
    });
    const balances = await net();
    expect(balances[alice]).toBe(0); // paid 1000, owes 1000
    expect(balances[bob]).toBe(1000); // paid item B via fallback, owes nothing
    expect(balances[carl]).toBe(-1000);
  });

  test('rejects an item payer who is not a group member', async () => {
    await expect(
      createItemizedExpense(db, alice, groupId, {
        description: 'Bad',
        payerId: alice,
        taxCents: 0,
        tipCents: 0,
        items: [{ name: 'X', amountCents: 500, participantIds: [alice], payerId: 'stranger' }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYER' });
  });

  test('deleteExpense removes it from the ledger and rebalances', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 3000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    let balances = await net();
    expect(balances[alice]).toBe(2000);
    expect(balances[bob]).toBe(-1000);

    await deleteExpense(db, alice, groupId, e.id);
    expect(await listExpenses(db, alice, groupId)).toHaveLength(0);
    balances = await net();
    expect(Object.values(balances).every((n) => n === 0)).toBe(true);
  });

  test('deleting a missing expense is NOT_FOUND', async () => {
    await expect(deleteExpense(db, alice, groupId, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('an expense cannot be deleted once a payment has been recorded', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    await recordSettlement(db, alice, groupId, { fromUserId: bob, toUserId: alice, amountCents: 500 });
    await expect(deleteExpense(db, alice, groupId, e.id)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await listExpenses(db, alice, groupId)).toHaveLength(1);
  });

  test('an expense cannot be edited once a payment has been recorded', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    await recordSettlement(db, alice, groupId, { fromUserId: bob, toUserId: alice, amountCents: 500 });
    await expect(
      updateExpense(db, alice, groupId, e.id, {
        description: 'Changed',
        amountCents: 2000,
        payerId: alice,
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }, { userId: bob }],
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });
});

describe('adding a member re-splits shared equal expenses', () => {
  test('folds a new member into everyone-splits, leaves subset + non-equal alone', async () => {
    // Dinner split among everyone (alice, bob, carl); Cab split only among alice.
    await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 3000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    await createExpense(db, alice, groupId, {
      description: 'Cab',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }],
    });

    const dana = (await addPlaceholderMember(db, alice, groupId, 'Dana')).userId;

    const exps = await listExpenses(db, alice, groupId);
    const dinner = exps.find((e) => e.description === 'Dinner')!;
    // 3000 now split 4 ways.
    expect(owed(dinner.splits)).toEqual({ [alice]: 750, [bob]: 750, [carl]: 750, [dana]: 750 });
    // Subset split is deliberate — untouched.
    const cab = exps.find((e) => e.description === 'Cab')!;
    expect(owed(cab.splits)).toEqual({ [alice]: 1000 });
  });

  test('folds a new member into an itemized receipt shared by everyone', async () => {
    await createItemizedExpense(db, alice, groupId, {
      description: 'Table',
      payerId: alice,
      taxCents: 0,
      tipCents: 0,
      items: [{ name: 'Shared platter', amountCents: 3000, participantIds: [alice, bob, carl] }],
    });
    const dana = (await addPlaceholderMember(db, alice, groupId, 'Dana')).userId;
    const table = (await listExpenses(db, alice, groupId)).find((e) => e.description === 'Table')!;
    // 3000 now split 4 ways.
    expect(owed(table.splits)).toEqual({ [alice]: 750, [bob]: 750, [carl]: 750, [dana]: 750 });
  });

  test('leaves an itemized receipt with a subset item untouched', async () => {
    await createItemizedExpense(db, alice, groupId, {
      description: 'Mixed table',
      payerId: alice,
      taxCents: 0,
      tipCents: 0,
      items: [
        { name: 'Shared', amountCents: 3000, participantIds: [alice, bob, carl] },
        { name: 'Just Alice', amountCents: 1000, participantIds: [alice] },
      ],
    });
    const dana = (await addPlaceholderMember(db, alice, groupId, 'Dana')).userId;
    const table = (await listExpenses(db, alice, groupId)).find((e) => e.description === 'Mixed table')!;
    // Not every item was shared by everyone, so the receipt is left as-is (no Dana).
    expect(table.splits.some((s) => s.userId === dana)).toBe(false);
  });

  test('leaves EXACT splits untouched when a member is added', async () => {
    await createExpense(db, alice, groupId, {
      description: 'Tickets',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EXACT',
      participants: [
        { userId: alice, value: 600 },
        { userId: bob, value: 400 },
      ],
    });
    const dana = (await addPlaceholderMember(db, alice, groupId, 'Dana')).userId;
    const tickets = (await listExpenses(db, alice, groupId)).find((e) => e.description === 'Tickets')!;
    expect(owed(tickets.splits)).toEqual({ [alice]: 600, [bob]: 400 });
    expect(tickets.splits.some((s) => s.userId === dana)).toBe(false);
  });
});

describe('expenses — editing', () => {
  test('updateExpense recomputes splits and rebalances, preserving id', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 3000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    const updated = await updateExpense(db, alice, groupId, e.id, {
      description: 'Dinner (fixed)',
      amountCents: 1500,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    expect(updated.id).toBe(e.id);
    expect(updated.description).toBe('Dinner (fixed)');
    expect(owed(updated.splits)).toEqual({ [alice]: 750, [bob]: 750 });
    const list = await listExpenses(db, alice, groupId);
    expect(list).toHaveLength(1); // still one expense, edited in place
    expect((await net())[carl]).toBe(0); // Carl dropped from the split
    expect((await net())[alice]).toBe(750);
  });

  test('updateItemizedExpense swaps the line items', async () => {
    const e = await createItemizedExpense(db, alice, groupId, {
      description: 'Lunch',
      payerId: bob,
      taxCents: 0,
      tipCents: 0,
      items: [{ name: 'Burger', amountCents: 1000, participantIds: [alice] }],
    });
    const updated = await updateItemizedExpense(db, alice, groupId, e.id, {
      description: 'Lunch',
      payerId: bob,
      taxCents: 200,
      tipCents: 0,
      items: [
        { name: 'Burger', amountCents: 1000, participantIds: [alice] },
        { name: 'Fries', amountCents: 500, participantIds: [alice, bob] },
      ],
    });
    expect(updated.amountCents).toBe(1000 + 500 + 200);
    expect(updated.splits.reduce((s, x) => s + x.owedCents, 0)).toBe(updated.amountCents);
    expect(Object.values(await net()).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('listExpenses returns line items + tax/tip for an itemized expense', async () => {
    const e = await createItemizedExpense(db, alice, groupId, {
      description: 'Dinner',
      payerId: bob,
      taxCents: 300,
      tipCents: 200,
      items: [
        { name: 'Pizza', amountCents: 1800, participantIds: [alice, bob] },
        { name: 'Salad', amountCents: 1200, participantIds: [carl] },
      ],
    });
    const listed = (await listExpenses(db, alice, groupId)).find((x) => x.id === e.id);
    expect(listed?.taxCents).toBe(300);
    expect(listed?.tipCents).toBe(200);
    expect(listed?.items).toHaveLength(2);
    const pizza = listed?.items?.find((i) => i.name === 'Pizza');
    expect(pizza?.amountCents).toBe(1800);
    expect(new Set(pizza?.participantIds)).toEqual(new Set([alice, bob]));
  });

  test('a simple expense has no items attached', async () => {
    const e = await createExpense(db, alice, groupId, {
      description: 'Cab',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    const listed = (await listExpenses(db, alice, groupId)).find((x) => x.id === e.id);
    expect(listed?.items).toBeUndefined();
  });

  test('a backdated expense keeps its date; an undated one falls back to createdAt', async () => {
    const backdate = new Date('2020-01-15T00:00:00.000Z');
    const dated = await createExpense(db, alice, groupId, {
      description: 'Old dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
      date: backdate,
    });
    expect(dated.date.getTime()).toBe(backdate.getTime());

    const undated = await createExpense(db, alice, groupId, {
      description: 'Recent',
      amountCents: 500,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }],
    });
    const listed = await listExpenses(db, alice, groupId);
    const l1 = listed.find((x) => x.id === dated.id);
    const l2 = listed.find((x) => x.id === undated.id);
    expect(l1?.date.getTime()).toBe(backdate.getTime());
    // undated: effective date equals its createdAt (both "now"), and is far after 2020
    expect(l2?.date.getTime()).toBe(l2?.createdAt.getTime());
    expect(l2!.date.getTime()).toBeGreaterThan(backdate.getTime());
  });

  test('editing a missing expense is NOT_FOUND', async () => {
    await expect(
      updateExpense(db, alice, groupId, 'nope', {
        description: 'x',
        amountCents: 100,
        payerId: alice,
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the leftover cent', () => {
  // An equal split of an amount that does not divide evenly has to give someone an extra cent. Which
  // someone is seeded from the expense id, so it varies between expenses instead of always landing on
  // whoever is listed first. Two things must hold for that to be safe.

  test('editing an expense never moves it to someone else', async () => {
    // The seed is the expense id, so a recompute is stable. If it were not, editing the description of
    // a bill would silently move a cent of debt between two people.
    const e = await createExpense(db, alice, groupId, {
      description: 'Coffee',
      amountCents: 100,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    const before = owed(e.splits);

    const after = await updateExpense(db, alice, groupId, e.id, {
      description: 'Coffee and a bun',
      amountCents: 100,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
    });
    expect(owed(after.splits)).toEqual(before);
  });

  test('still adds up to the bill exactly', async () => {
    for (const amountCents of [100, 1649, 3850, 585, 1040]) {
      const e = await createExpense(db, alice, groupId, {
        description: `bill ${amountCents}`,
        amountCents,
        payerId: alice,
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }, { userId: bob }, { userId: carl }],
      });
      const total = Object.values(owed(e.splits)).reduce((a, b) => a + b, 0);
      expect(total).toBe(amountCents);
      // Nobody is ever more than a cent off anyone else on a single bill.
      const values = Object.values(owed(e.splits));
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });
});

describe('corrections leave a trace', () => {
  const dinner = () =>
    createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 4000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });

  const edit = (id: string, over: Record<string, unknown> = {}) =>
    updateExpense(db, alice, groupId, id, {
      description: 'Dinner',
      amountCents: 4000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
      ...over,
    } as never);

  test('records what an expense used to say', async () => {
    /*
     * The gap this closes: editing overwrote in place, so a $40 dinner becoming $80 left no evidence
     * except everybody's balance moving.
     */
    const created = await dinner();
    await edit(created.id, { amountCents: 8000 });

    const [listed] = await listExpenses(db, alice, groupId);
    expect(listed!.amountCents).toBe(8000);
    expect(listed!.lastEdit).toMatchObject({ byId: alice, fields: ['amount'], formerAmountCents: 4000 });
  });

  test('says nothing when the form was re-saved unchanged', async () => {
    // A row for a non-edit would bury the ones that matter.
    const created = await dinner();
    await edit(created.id);
    expect((await listExpenses(db, alice, groupId))[0]!.lastEdit).toBeUndefined();
  });

  test('keeps the newest correction, not the first', async () => {
    const created = await dinner();
    await edit(created.id, { amountCents: 8000 });
    await edit(created.id, { amountCents: 9000, description: 'Late dinner' });

    const last = (await listExpenses(db, alice, groupId))[0]!.lastEdit;
    expect(last).toMatchObject({ formerAmountCents: 8000 });
    expect(last!.fields).toEqual(['amount', 'description']);
  });

  test('names whoever made the change, not the payer', async () => {
    // The payer and the editor are different people often enough that conflating them is a real bug.
    const created = await dinner();
    const dave = await seedPerson(db, 'Dave');
    await addPlaceholderMember(db, alice, groupId, 'ignored');
    await updateExpense(db, alice, groupId, created.id, {
      description: 'Dinner',
      amountCents: 4000,
      payerId: bob,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    } as never);
    const last = (await listExpenses(db, alice, groupId))[0]!.lastEdit;
    expect(last!.byId).toBe(alice);
    expect(last!.fields).toEqual(['payer']);
    expect(dave).toBeTruthy();
  });

  test('leaves an expense nobody edited without a trace', async () => {
    await dinner();
    expect((await listExpenses(db, alice, groupId))[0]!.lastEdit).toBeUndefined();
  });

  test('does not record anything when the edit is rejected', async () => {
    // Written after the update, so a failed edit cannot log a change that never happened.
    const created = await dinner();
    await expect(
      updateExpense(db, alice, groupId, created.id, {
        description: 'Dinner',
        amountCents: 8000,
        payerId: 'nobody',
        splitMethod: 'EQUAL',
        participants: [{ userId: alice }, { userId: bob }],
      } as never),
    ).rejects.toBeInstanceOf(ExpenseError);
    expect((await listExpenses(db, alice, groupId))[0]!.lastEdit).toBeUndefined();
  });
});

describe('the note', () => {
  test('round-trips, and an emptied field clears it', async () => {
    const created = await createExpense(db, alice, groupId, {
      description: 'Dinner',
      amountCents: 6_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
      note: "Mara's birthday, she didn't pay",
    });
    expect((await listExpenses(db, alice, groupId))[0]!.note).toBe("Mara's birthday, she didn't pay");

    // An edit that omits the note is an edit that removed it: the form always sends the field.
    await updateExpense(db, alice, groupId, created.id, {
      description: 'Dinner',
      amountCents: 6_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    expect((await listExpenses(db, alice, groupId))[0]!.note).toBeNull();
  });

  test('is null on an expense that never had one', async () => {
    await createExpense(db, alice, groupId, {
      description: 'Taxi',
      amountCents: 2_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    expect((await listExpenses(db, alice, groupId))[0]!.note).toBeNull();
  });
});
