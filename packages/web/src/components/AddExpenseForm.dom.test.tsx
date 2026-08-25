import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

/**
 * The form every expense enters through, driven.
 *
 * It is the largest untested thing in the app and the only one where a bug writes bad data rather
 * than drawing a bad screen. Four kinds of rule live in here and each fails differently:
 *
 *   1. Custom splits have to reconcile. An EXACT split that does not add up to the total, or
 *      percentages that do not reach 100, make the group's arithmetic wrong from its first expense
 *      and there is nothing later that notices.
 *   2. The client id is minted before the request and reused by the queued retry, which is the only
 *      reason a save that times out and is sent again does not become two expenses.
 *   3. An edit carries the version it was based on; a create has none. That is the whole of the
 *      optimistic-concurrency story on this path.
 *   4. Editing has to prefill what the payer originally typed, not what the server computed, or
 *      opening and re-saving an expense silently rewrites the split.
 */

const create = vi.fn<(groupId: string, payload: Record<string, unknown>) => Promise<Expense>>();
const update = vi.fn<(g: string, id: string, payload: Record<string, unknown>) => Promise<Expense>>();
vi.mock('../lib/expenses', () => ({
  expensesApi: {
    create: (g: string, p: Record<string, unknown>) => create(g, p),
    update: (g: string, id: string, p: Record<string, unknown>) => update(g, id, p),
  },
}));

const enqueue = vi.fn();
const offline = { value: false };
vi.mock('../lib/outbox', () => ({
  enqueue: (row: unknown) => enqueue(row),
  isOffline: () => offline.value,
}));

const member = (userId: string, displayName: string): GroupMember => ({
  userId,
  displayName,
  email: null,
  role: 'MEMBER',
  joinedAt: '2026-01-01T00:00:00.000Z',
  isPlaceholder: false,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
});

const MEMBERS = [member('a', 'Alice'), member('b', 'Bob')];

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  description: 'Dinner',
  amountCents: 9_000,
  payerId: 'a',
  splitMethod: 'EQUAL',
  category: 'food',
  createdAt: '2026-08-11T18:00:00.000Z',
  date: '2026-08-11T18:00:00.000Z',
  note: null,
  version: 4,
  splits: [
    { userId: 'a', owedCents: 4_500 },
    { userId: 'b', owedCents: 4_500 },
  ],
  ...over,
});

const onCreated = vi.fn();
const onQueued = vi.fn();

async function open(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  const { AddExpenseForm } = await import('./AddExpenseForm');
  render(
    <AddExpenseForm groupId="g1" members={MEMBERS} onCreated={onCreated} onQueued={onQueued} {...props} />,
  );
  return user;
}

async function fillBasics(user: Awaited<ReturnType<typeof open>>, amount = '90.00') {
  await user.type(screen.getByLabelText('What the expense was for'), 'Dinner');
  await user.type(screen.getByLabelText('Amount'), amount);
}

const submit = (user: Awaited<ReturnType<typeof open>>) =>
  user.click(screen.getByRole('button', { name: /Add expense|Save changes/ }));

beforeEach(() => {
  offline.value = false;
  for (const fn of [create, update, enqueue, onCreated, onQueued]) fn.mockReset();
  create.mockResolvedValue(expense());
  update.mockResolvedValue(expense({ version: 5 }));
  // Counted, not constant: the queued row must carry the id minted BEFORE the request, and a stub
  // returning the same value every call cannot tell that apart from a freshly minted one — the test
  // would pass against a broken retry.
  let n = 0;
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `cid-${++n}` });
});

describe('what it refuses to send', () => {
  /*
   * Description and amount are natively `required`, so the browser stops an empty submit before
   * onSubmit runs and the form's own messages for those two never appear. Asserted as the browser
   * behaviour it is, rather than against the unreachable branches behind it.
   */
  it.each([['What the expense was for'], ['Amount']])('will not submit without %s', async (filled) => {
    const user = await open();
    await user.type(screen.getByLabelText(filled), filled === 'Amount' ? '10' : 'Dinner');
    await submit(user);
    expect(create).not.toHaveBeenCalled();
  });

  // What native validation cannot catch: a field that is filled in but is not a number.
  it('rejects an amount that is not one', async () => {
    const user = await open();
    await user.type(screen.getByLabelText('What the expense was for'), 'Dinner');
    await user.type(screen.getByLabelText('Amount'), 'twelve');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid amount.');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a zero amount rather than booking a free dinner', async () => {
    const user = await open();
    await fillBasics(user, '0');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Amount must be more than zero.');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a split with nobody in it', async () => {
    const user = await open();
    await fillBasics(user);
    for (const m of MEMBERS) await user.click(screen.getByRole('checkbox', { name: m.displayName }));
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one person.');
    expect(create).not.toHaveBeenCalled();
  });
});

/*
 * The reconciliation guards. Nothing downstream re-checks these: the server takes the participant
 * values it is given, so a split that does not add up is simply wrong from then on.
 */
describe('custom splits have to add up', () => {
  it('says by how much an exact split is off, and does not send it', async () => {
    const user = await open();
    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Split method'), 'EXACT');
    await user.type(screen.getByLabelText('Amount for Alice'), '40');
    await user.type(screen.getByLabelText('Amount for Bob'), '30');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('$90.00');
    expect(screen.getByRole('alert')).toHaveTextContent('$70.00');
    expect(create).not.toHaveBeenCalled();
  });

  it('sends an exact split that reconciles, in cents', async () => {
    const user = await open();
    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Split method'), 'EXACT');
    await user.type(screen.getByLabelText('Amount for Alice'), '60');
    await user.type(screen.getByLabelText('Amount for Bob'), '30');
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1]).toMatchObject({
      amountCents: 9_000,
      splitMethod: 'EXACT',
      participants: [
        { userId: 'a', value: 6_000 },
        { userId: 'b', value: 3_000 },
      ],
    });
  });

  it('holds percentages to 100 and reports the shortfall', async () => {
    const user = await open();
    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Split method'), 'PERCENT');
    await user.type(screen.getByLabelText('Percent for Alice'), '60');
    await user.type(screen.getByLabelText('Percent for Bob'), '30');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('90.00%');
    expect(create).not.toHaveBeenCalled();
  });

  it('sends percentages as basis points once they reach 100', async () => {
    const user = await open();
    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Split method'), 'PERCENT');
    await user.type(screen.getByLabelText('Percent for Alice'), '62.5');
    await user.type(screen.getByLabelText('Percent for Bob'), '37.5');
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1]).toMatchObject({
      participants: [
        { userId: 'a', value: 6_250 },
        { userId: 'b', value: 3_750 },
      ],
    });
  });

  // Shares are a weighting, so they need no total, but a fractional or zero weight is meaningless.
  it('rejects a share weight that is not a positive whole number', async () => {
    const user = await open();
    await fillBasics(user);
    await user.selectOptions(screen.getByLabelText('Split method'), 'SHARES');
    await user.type(screen.getByLabelText('Shares for Alice'), '1.5');
    await user.type(screen.getByLabelText('Shares for Bob'), '1');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Check the values for each person.');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('editing an expense someone already saved', () => {
  const EXACT = expense({
    splitMethod: 'EXACT',
    splits: [
      { userId: 'a', owedCents: 6_000, inputValue: 6_000 },
      { userId: 'b', owedCents: 3_000, inputValue: 3_000 },
    ],
  });

  /*
   * Prefilled from what the payer typed, not from what the server computed. If this reversed the
   * encoding wrongly, opening an expense and pressing save would quietly rewrite the split.
   */
  it('prefills the amounts the payer originally entered', async () => {
    await open({ editing: EXACT });
    expect(screen.getByLabelText('Amount for Alice')).toHaveValue('60.00');
    expect(screen.getByLabelText('Amount for Bob')).toHaveValue('30.00');
  });

  it('sends the version it was based on, so a stale edit can be caught', async () => {
    const user = await open({ editing: EXACT });
    await submit(user);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![2]).toMatchObject({ expectedVersion: 4 });
  });

  it('a create has no version to be based on', async () => {
    const user = await open();
    await fillBasics(user);
    await submit(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1]).not.toHaveProperty('expectedVersion');
  });

  // A payer who has since been removed cannot stay selected, or the edit re-sends a stranger.
  it('falls back to a real member when the payer is gone', async () => {
    const user = await open({ editing: expense({ payerId: 'ghost' }) });
    await submit(user);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![2]).toMatchObject({ payerId: 'a' });
  });
});

/*
 * The offline path. `clientId` is minted before the request precisely so the queued copy carries
 * the same one: the server recognises the retry as the expense it may already have written, and a
 * save that timed out on a train does not become two dinners.
 */
describe('when the write cannot leave the device', () => {
  it('queues a new expense under the id the failed attempt used', async () => {
    offline.value = true;
    create.mockRejectedValue(new Error('offline'));
    const user = await open();
    await fillBasics(user);
    await submit(user);
    await waitFor(() => expect(enqueue).toHaveBeenCalled());
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      clientId: 'cid-1',
      kind: 'expense',
      groupId: 'g1',
      payload: { clientId: 'cid-1', amountCents: 9_000 },
    });
    expect(onQueued).toHaveBeenCalledWith('Dinner');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('queues an edit as an edit, against the row it edits', async () => {
    offline.value = true;
    update.mockRejectedValue(new Error('offline'));
    const user = await open({ editing: expense() });
    await submit(user);
    await waitFor(() => expect(enqueue).toHaveBeenCalled());
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ kind: 'edit', expenseId: 'e1' });
  });

  // A failure that is not the network is the server saying no. Queueing it would retry something
  // that will be refused again, so it is reported instead.
  it('reports a rejection rather than queueing it', async () => {
    create.mockRejectedValue(new Error('That description is too long.'));
    const user = await open();
    await fillBasics(user);
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('That description is too long.');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
