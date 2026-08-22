import { beforeEach, describe, expect, test } from 'vitest';
import {
  GroupError,
  addPlaceholderMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeMember,
  renameGroup,
  renameMember,
  setGroupArchived,
  setGroupBudget,
  setGroupCurrency,
  setSettlementDeadline,
  getOrCreateShareToken,
  getSharedSummary,
  claimPlaceholder,
} from '../src/groups.js';
import { createExpense, getBalances } from '../src/expenses.js';
import { listSettlements, recordSettlement } from '../src/settlements.js';
import { testDb, seedPerson } from './helpers.js';

let alice: string;
beforeEach(async () => {
  alice = await seedPerson(testDb(), 'Alice');
});

describe('groups', () => {
  test('createGroup adds the creator as OWNER', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    expect(group.name).toBe('Trip');
    expect(group.createdById).toBe(alice);
    expect(group.members).toHaveLength(1);
    expect(group.members[0]).toMatchObject({ userId: alice, role: 'OWNER', displayName: 'Alice' });
  });

  test('addPlaceholderMember creates a name-only member', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = await addPlaceholderMember(db, alice, group.id, 'Bob');
    expect(bob).toMatchObject({ displayName: 'Bob', role: 'MEMBER', email: null });
    const fetched = await getGroup(db, alice, group.id);
    expect(fetched.members.map((m) => m.displayName).sort()).toEqual(['Alice', 'Bob']);
  });

  test('listGroups reports member count and the viewer net', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    await addPlaceholderMember(db, alice, group.id, 'Bob');
    const summaries = await listGroups(db, alice);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: group.id, memberCount: 2, netCents: 0 });
  });

  test('renameGroup requires ownership', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = await seedPerson(db, 'Bob');
    // Bob is not even a member: membership check fails first.
    await expect(renameGroup(db, bob, group.id, 'Hijacked')).rejects.toBeInstanceOf(GroupError);
    const renamed = await renameGroup(db, alice, group.id, 'Weekend');
    expect(renamed.name).toBe('Weekend');
  });

  test('the owner can set and clear a shared settle-by deadline', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const deadline = new Date('2026-08-20T22:00:00.000Z');
    expect((await setSettlementDeadline(db, alice, group.id, deadline)).settleBy).toEqual(deadline);
    expect((await setSettlementDeadline(db, alice, group.id, null)).settleBy).toBeNull();

    const bob = await seedPerson(db, 'Bob');
    await expect(setSettlementDeadline(db, bob, group.id, deadline)).rejects.toBeInstanceOf(GroupError);
  });

  test('the owner can set and clear a shared budget', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    expect((await setGroupBudget(db, alice, group.id, 150_000)).budgetCents).toBe(150_000);
    expect((await setGroupBudget(db, alice, group.id, null)).budgetCents).toBeNull();
  });

  /*
   * Enforced here rather than only by hiding the buttons.
   *
   * The budget is one shared number that changes what all four people see, so a member who could set it
   * could quietly tell everybody else they had overspent. The UI hides the controls from non-owners, but
   * the UI is not a permission system.
   */
  test('a member cannot set the budget (NOT_OWNER)', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const memberId = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await expect(setGroupBudget(db, memberId, group.id, 150_000)).rejects.toMatchObject({ code: 'NOT_OWNER' });

    const stranger = await seedPerson(db, 'Nosy');
    // A non-member gets NOT_FOUND rather than NOT_OWNER, which is the existing convention: telling a
    // stranger "you are not the owner" confirms the group exists.
    await expect(setGroupBudget(db, stranger, group.id, 150_000)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('a group counts in dollars unless it is told otherwise', async () => {
    const db = testDb();
    expect((await createGroup(db, alice, 'Flat')).currency).toBe('USD');
    expect((await createGroup(db, alice, 'Lisbon', 'EUR')).currency).toBe('EUR');
  });

  /*
   * The currency is a label on a ledger of integer minor units, so changing it must not touch a single
   * stored amount. A conversion would need a rate and a date, and would rewrite numbers the group has
   * already agreed on; this only changes how they read.
   */
  test('changing the currency relabels without moving any money', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Lisbon');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 4_000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });

    const before = await getBalances(db, alice, group.id);
    expect((await setGroupCurrency(db, alice, group.id, 'EUR')).currency).toBe('EUR');
    expect(await getBalances(db, alice, group.id)).toEqual(before);
  });

  test('only the owner can change the currency, and only to one we can count in', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Lisbon');
    const memberId = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await expect(setGroupCurrency(db, memberId, group.id, 'EUR')).rejects.toMatchObject({ code: 'NOT_OWNER' });
    // Yen has no minor unit, so a ledger of hundredths would allocate amounts nobody can pay.
    await expect(setGroupCurrency(db, alice, group.id, 'JPY')).rejects.toMatchObject({ code: 'INVALID_CURRENCY' });
    await expect(createGroup(db, alice, 'Tokyo', 'JPY')).rejects.toMatchObject({ code: 'INVALID_CURRENCY' });
  });

  test('rejects a budget that is not an amount', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      await expect(setGroupBudget(db, alice, group.id, bad)).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
    }
    // And leaves the stored value alone rather than half-applying one of those.
    expect((await getGroup(db, alice, group.id)).budgetCents).toBeNull();
  });

  test('a non-owner member cannot rename (NOT_OWNER)', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const memberId = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await expect(renameGroup(db, memberId, group.id, 'Nope')).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
  });

  test('cannot remove the owner; deleteGroup cascades', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    await expect(removeMember(db, alice, group.id, alice)).rejects.toMatchObject({
      code: 'CANNOT_REMOVE_OWNER',
    });
    await deleteGroup(db, alice, group.id);
    await expect(getGroup(db, alice, group.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('removing a member re-splits their share among the rest, no settlements invented', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    const carol = (await addPlaceholderMember(db, alice, group.id, 'Carol')).userId;

    // Alice pays 600 split three ways: each owes 200 (Alice +400, Bob -200, Carol -200).
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 600,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }, { userId: carol }],
    });

    await removeMember(db, alice, group.id, bob);

    // Bob is gone, nothing is marked settled, and his 200 share was absorbed by Alice + Carol
    // (dinner re-splits two ways: 300 each → Alice +300, Carol -300). Ledger still nets to zero.
    const g = await getGroup(db, alice, group.id);
    expect(g.members.map((m) => m.userId)).not.toContain(bob);
    expect(await listSettlements(db, alice, group.id)).toHaveLength(0);
    const balances = await getBalances(db, alice, group.id);
    const byId = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
    expect(byId[alice]).toBe(300);
    expect(byId[carol]).toBe(-300);
    expect(balances.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  test('a member cannot be removed once a payment has been recorded', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    // Once anyone's marked paid, removal is blocked (it would break the recorded payment).
    await recordSettlement(db, alice, group.id, { fromUserId: bob, toUserId: alice, amountCents: 500 });
    await expect(removeMember(db, alice, group.id, bob)).rejects.toMatchObject({ code: 'HAS_ACTIVITY' });
    expect((await getGroup(db, alice, group.id)).members.map((m) => m.userId)).toContain(bob);
  });

  test('removing a member who paid hands their expense to the owner', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip'); // Alice is owner
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;

    // Bob pays 100 split with Alice: Alice owes Bob 50.
    await createExpense(db, alice, group.id, {
      description: 'Cab',
      amountCents: 100,
      payerId: bob,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });

    await removeMember(db, alice, group.id, bob);

    // The payment is handed to the owner and Bob's share re-splits to Alice: it's now Alice's
    // own $100 expense → she nets zero, and no settlement was invented.
    const byId = Object.fromEntries((await getBalances(db, alice, group.id)).map((b) => [b.userId, b.netCents]));
    expect(byId[alice]).toBe(0);
    expect(await listSettlements(db, alice, group.id)).toHaveLength(0);
  });

  test('share token is stable and its public summary reflects the group', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
      category: 'food',
    });

    const token = await getOrCreateShareToken(db, alice, group.id);
    expect(token).toMatch(/^[a-f0-9]{32,}$/);
    // Idempotent: the same token comes back on repeat.
    expect(await getOrCreateShareToken(db, alice, group.id)).toBe(token);
    // Non-members can't mint a link.
    const outsider = await seedPerson(db, 'Nate');
    await expect(getOrCreateShareToken(db, outsider, group.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const summary = await getSharedSummary(db, token);
    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      groupName: 'Trip',
      memberCount: 2,
      totalSpentCents: 1000,
      perPersonCents: 500,
    });
    expect(summary?.suggested).toEqual([{ fromName: 'Bob', toName: 'Alice', amountCents: 500 }]);
    expect(summary?.breakdown).toEqual([{ category: 'food', cents: 1000 }]);

    // An unknown token resolves to nothing, not someone else's group.
    expect(await getSharedSummary(db, 'not-a-real-token')).toBeNull();
  });

  test('claiming a placeholder seat merges its history into the caller', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bobSeat = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    const carolSeat = (await addPlaceholderMember(db, alice, group.id, 'Carol')).userId;
    // Alice pays 1000 split with the Bob seat: that seat owes 500.
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bobSeat }],
    });
    const token = await getOrCreateShareToken(db, alice, group.id);

    const realBob = await seedPerson(db, 'Bob Real');
    const { groupId } = await claimPlaceholder(db, realBob, token, bobSeat);
    expect(groupId).toBe(group.id);

    // realBob is now a member; the placeholder seat is gone, count unchanged.
    const fetched = await getGroup(db, realBob, group.id);
    const ids = fetched.members.map((m) => m.userId);
    expect(ids).toContain(realBob);
    expect(ids).not.toContain(bobSeat);
    expect(fetched.members).toHaveLength(3);

    // The seat's debt carried over.
    const bal = Object.fromEntries((await getBalances(db, realBob, group.id)).map((b) => [b.userId, b.netCents]));
    expect(bal[realBob]).toBe(-500);
    expect(bal[alice]).toBe(500);

    // Guards: the claimed seat can't be taken again, a current member can't claim, bad token fails.
    const nate = await seedPerson(db, 'Nate');
    await expect(claimPlaceholder(db, nate, token, bobSeat)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(claimPlaceholder(db, alice, token, carolSeat)).rejects.toMatchObject({ code: 'ALREADY_MEMBER' });
    await expect(claimPlaceholder(db, nate, 'not-a-token', carolSeat)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('unknown group is NOT_FOUND', async () => {
    await expect(getGroup(testDb(), alice, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('renameMember renames a placeholder', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    const renamed = await renameMember(db, alice, group.id, bob, 'Bobby');
    expect(renamed.displayName).toBe('Bobby');
    const fetched = await getGroup(db, alice, group.id);
    expect(fetched.members.find((m) => m.userId === bob)?.displayName).toBe('Bobby');
  });

  test('archive hides the group from the active flag; unarchive restores it', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    expect((await listGroups(db, alice))[0]?.archived).toBe(false);

    const archived = await setGroupArchived(db, alice, group.id, true);
    expect(archived.archived).toBe(true);
    expect((await listGroups(db, alice))[0]?.archived).toBe(true);
    expect((await getGroup(db, alice, group.id)).archived).toBe(true);

    const restored = await setGroupArchived(db, alice, group.id, false);
    expect(restored.archived).toBe(false);
  });

  test('archiving is a personal hide, not a freeze — the group stays editable', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;
    await setGroupArchived(db, alice, group.id, true);

    // Everything still works after archiving; there is no read-only state.
    expect((await renameGroup(db, alice, group.id, 'Weekend')).name).toBe('Weekend');
    expect((await renameMember(db, alice, group.id, bob, 'Bobby')).displayName).toBe('Bobby');
    await createExpense(db, alice, group.id, {
      description: 'Dinner',
      amountCents: 1000,
      payerId: alice,
      splitMethod: 'EQUAL',
      participants: [{ userId: alice }, { userId: bob }],
    });
    const bal = Object.fromEntries((await getBalances(db, alice, group.id)).map((b) => [b.userId, b.netCents]));
    expect(bal[bob]).toBe(-500);
  });

  test('archive is per-member — each member hides their own view independently', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    const bob = (await addPlaceholderMember(db, alice, group.id, 'Bob')).userId;

    // Alice hides it: archived in her view, still active in Bob's. (Any member may archive.)
    await setGroupArchived(db, alice, group.id, true);
    expect((await listGroups(db, alice)).find((g) => g.id === group.id)?.archived).toBe(true);
    expect((await listGroups(db, bob)).find((g) => g.id === group.id)?.archived).toBe(false);

    // Bob hides his view too; Alice unhides hers. The two are independent.
    await setGroupArchived(db, bob, group.id, true);
    await setGroupArchived(db, alice, group.id, false);
    expect((await listGroups(db, alice)).find((g) => g.id === group.id)?.archived).toBe(false);
    expect((await listGroups(db, bob)).find((g) => g.id === group.id)?.archived).toBe(true);
  });

  test('renameMember refuses a real account (owner) and a non-member', async () => {
    const db = testDb();
    const group = await createGroup(db, alice, 'Trip');
    // Alice is a real (non-placeholder) account: her name is owned by auth.
    await expect(renameMember(db, alice, group.id, alice, 'Hacker')).rejects.toMatchObject({
      code: 'NOT_PLACEHOLDER',
    });
    const outsider = await seedPerson(db, 'Nate');
    await expect(renameMember(db, alice, group.id, outsider, 'Nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
