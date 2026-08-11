import { beforeEach, describe, expect, test } from 'vitest';
import { addPlaceholderMember, createGroup } from '../src/groups.js';
import { getBalances, listExpenses } from '../src/expenses.js';
import {
  acceptOccurrence,
  createRecurringRule,
  listRecurringRules,
  RecurringRuleError,
  setRecurringActive,
  skipOccurrence,
} from '../src/recurring.js';
import { testDb, seedPerson } from './helpers.js';

/*
 * Bills that come round again.
 *
 * The date maths is property-tested in @owewell/shared; this covers the part a database can get wrong:
 * who is allowed to write a rule, that accepting one produces exactly one real expense, and that the
 * accept endpoint cannot be used to post an expense on any date the caller feels like.
 */

let db: ReturnType<typeof testDb>;
let alice: string;
let bob: string;
let outsider: string;
let groupId: string;
let carol: string;

const RENT = {
  description: 'Rent',
  amountCents: 240_000,
  cadence: 'monthly',
  startsOn: '2026-01-01',
};

beforeEach(async () => {
  db = testDb();
  alice = await seedPerson(db, 'Alice');
  bob = await seedPerson(db, 'Bob');
  outsider = await seedPerson(db, 'Outsider');
  const group = await createGroup(db, alice, 'Flat');
  groupId = group.id;
  carol = (await addPlaceholderMember(db, alice, groupId, 'Carol')).userId;
  // Bob is a real member, so "somebody else in the group" is an honest case rather than a placeholder.
  // Inserted the same way createGroup does it: the row needs its own id and a role.
  const { groupMembers } = await import('../src/db/schema.js');
  await db.insert(groupMembers).values({ id: crypto.randomUUID(), groupId, personId: bob, role: 'MEMBER' });
});

describe('writing a rule', () => {
  test('records the template and works out when it next comes round', async () => {
    const rule = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol] },
      '2026-01-15',
    );

    expect(rule.cadenceLabel).toBe('every month on the 1st');
    expect(rule.nextOn).toBe('2026-02-01');
    expect(rule.participantIds).toHaveLength(2);
    expect(rule.dueDates).toEqual(['2026-01-01']);
  });

  test('does not immediately propose a bill that was just entered by hand', async () => {
    // handledThrough is what makes "make this repeat" on an existing expense not double it up.
    const rule = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol], handledThrough: '2026-01-01' },
      '2026-01-15',
    );
    expect(rule.dueDates).toEqual([]);
    expect(rule.nextOn).toBe('2026-02-01');
  });

  test('refuses a payer or participant who is not in the group', async () => {
    await expect(
      createRecurringRule(db, alice, groupId, { ...RENT, payerId: outsider, participantIds: [alice] }, '2026-01-15'),
    ).rejects.toThrow(RecurringRuleError);
    await expect(
      createRecurringRule(db, alice, groupId, { ...RENT, payerId: alice, participantIds: [outsider] }, '2026-01-15'),
    ).rejects.toThrow(RecurringRuleError);
  });

  test('refuses a date that does not exist', async () => {
    await expect(
      createRecurringRule(
        db,
        alice,
        groupId,
        { ...RENT, startsOn: '2026-02-30', payerId: alice, participantIds: [alice] },
        '2026-01-15',
      ),
    ).rejects.toThrow(RecurringRuleError);
  });

  test('refuses a nonsense cadence, amount or empty split', async () => {
    const base = { ...RENT, payerId: alice, participantIds: [alice] };
    await expect(createRecurringRule(db, alice, groupId, { ...base, cadence: 'hourly' }, '2026-01-15')).rejects.toThrow(
      RecurringRuleError,
    );
    await expect(createRecurringRule(db, alice, groupId, { ...base, amountCents: 0 }, '2026-01-15')).rejects.toThrow(
      RecurringRuleError,
    );
    await expect(
      createRecurringRule(db, alice, groupId, { ...base, participantIds: [] }, '2026-01-15'),
    ).rejects.toThrow(RecurringRuleError);
  });

  test('keeps non-members out entirely', async () => {
    await expect(
      createRecurringRule(db, outsider, groupId, { ...RENT, payerId: alice, participantIds: [alice] }, '2026-01-15'),
    ).rejects.toThrow();
    await expect(listRecurringRules(db, outsider, groupId, '2026-01-15')).rejects.toThrow();
  });
});

describe('accepting what is due', () => {
  let ruleId: string;

  beforeEach(async () => {
    const rule = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol] },
      '2026-03-15',
    );
    ruleId = rule.id;
  });

  test('creates exactly one real expense and stops proposing that month', async () => {
    const before = (await listExpenses(db, alice, groupId)).length;
    const rule = await acceptOccurrence(db, alice, groupId, ruleId, '2026-01-01', '2026-03-15');

    const after = await listExpenses(db, alice, groupId);
    expect(after.length).toBe(before + 1);
    expect(after[0]?.description).toBe('Rent');
    expect(rule.dueDates).toEqual(['2026-02-01', '2026-03-01']);
  });

  test('splits it evenly and moves the balances', async () => {
    await acceptOccurrence(db, alice, groupId, ruleId, '2026-01-01', '2026-03-15');
    const balances = await getBalances(db, alice, groupId);
    const net = new Map(balances.map((b) => [b.userId, b.netCents]));
    // Alice paid 2400 for the two of them, so she is up 1200 and Carol is down 1200.
    expect(net.get(alice)).toBe(120_000);
    expect(net.get(carol)).toBe(-120_000);
  });

  /*
   * The check that makes this endpoint safe.
   *
   * Without it, "accept" is a way to post an expense dated anything you like using a rule as cover, and
   * replaying an old response would add the same month's rent twice.
   */
  test('refuses a date the rule never proposed', async () => {
    await expect(acceptOccurrence(db, alice, groupId, ruleId, '2026-01-15', '2026-03-15')).rejects.toThrow(
      RecurringRuleError,
    );
    await expect(acceptOccurrence(db, alice, groupId, ruleId, '2027-01-01', '2026-03-15')).rejects.toThrow(
      RecurringRuleError,
    );
  });

  test('refuses the same occurrence twice', async () => {
    await acceptOccurrence(db, alice, groupId, ruleId, '2026-01-01', '2026-03-15');
    await expect(acceptOccurrence(db, alice, groupId, ruleId, '2026-01-01', '2026-03-15')).rejects.toThrow(
      RecurringRuleError,
    );
    expect((await listExpenses(db, alice, groupId)).length).toBe(1);
  });

  test('lets anyone in the group deal with it, not just whoever wrote the rule', async () => {
    const rule = await acceptOccurrence(db, bob, groupId, ruleId, '2026-01-01', '2026-03-15');
    expect(rule.dueDates).not.toContain('2026-01-01');
  });

  test('keeps non-members out', async () => {
    await expect(acceptOccurrence(db, outsider, groupId, ruleId, '2026-01-01', '2026-03-15')).rejects.toThrow();
    await expect(skipOccurrence(db, outsider, groupId, ruleId, '2026-01-01', '2026-03-15')).rejects.toThrow();
  });

  test('accepting the newest clears everything older, and never rewinds', async () => {
    // Somebody who has been away deals with this month and does not want last month re-proposed.
    const rule = await acceptOccurrence(db, alice, groupId, ruleId, '2026-03-01', '2026-03-15');
    expect(rule.dueDates).toEqual([]);
    // Then an older date must not reopen the queue.
    await expect(acceptOccurrence(db, alice, groupId, ruleId, '2026-01-01', '2026-03-15')).rejects.toThrow(
      RecurringRuleError,
    );
    expect((await listExpenses(db, alice, groupId)).length).toBe(1);
  });
});

describe('skipping', () => {
  test('clears the month without creating anything', async () => {
    const created = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol] },
      '2026-02-15',
    );
    const rule = await skipOccurrence(db, alice, groupId, created.id, '2026-01-01', '2026-02-15');

    expect(await listExpenses(db, alice, groupId)).toEqual([]);
    // Advancing on skip is what stops the same month being offered forever.
    expect(rule.dueDates).toEqual(['2026-02-01']);
  });
});

describe('stopping a rule', () => {
  test('proposes nothing once stopped, and keeps the expenses it already made', async () => {
    const created = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol] },
      '2026-02-15',
    );
    await acceptOccurrence(db, alice, groupId, created.id, '2026-01-01', '2026-02-15');

    const stopped = await setRecurringActive(db, alice, groupId, created.id, false, '2026-02-15');
    expect(stopped.active).toBe(false);
    expect(stopped.dueDates).toEqual([]);
    // The rule is kept rather than deleted, so the expense it made still has an explanation.
    expect((await listExpenses(db, alice, groupId)).length).toBe(1);
    expect((await listRecurringRules(db, alice, groupId, '2026-02-15')).length).toBe(1);

    const restarted = await setRecurringActive(db, alice, groupId, created.id, true, '2026-02-15');
    expect(restarted.dueDates).toEqual(['2026-02-01']);
  });

  test('refuses to accept anything while stopped', async () => {
    const created = await createRecurringRule(
      db,
      alice,
      groupId,
      { ...RENT, payerId: alice, participantIds: [alice, carol] },
      '2026-02-15',
    );
    await setRecurringActive(db, alice, groupId, created.id, false, '2026-02-15');
    await expect(acceptOccurrence(db, alice, groupId, created.id, '2026-01-01', '2026-02-15')).rejects.toThrow(
      RecurringRuleError,
    );
  });
});
