import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drop,
  enqueue,
  flush,
  isAlreadyDone,
  isConflict,
  isCreate,
  isDelete,
  isEdit,
  isOffline,
  isPendingRow,
  isSettlement,
  queued,
} from './outbox';
import { ApiError } from './api';
import type { CreateExpensePayload } from '@owewell/core';

/**
 * The queue that holds a write typed with no signal.
 *
 * Worth testing away from the DOM because the rules that matter here are all about what happens on
 * the unhappy path: which failures are worth retrying, what order things go out in, and what must
 * never be sent twice. The server refuses duplicates as well (see the API's clientId tests); this is
 * the half that decides whether a retry is even attempted.
 */

const payload = (description: string): CreateExpensePayload => ({
  description,
  amountCents: 1_000,
  payerId: 'u1',
  splitMethod: 'EQUAL',
  participants: [{ userId: 'u1' }, { userId: 'u2' }],
});

const entry = (clientId: string, at: number, groupId = 'g1') => ({
  clientId,
  groupId,
  kind: 'expense' as const,
  description: clientId,
  amountCents: 1_000,
  queuedAt: at,
  payload: payload(clientId),
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

describe('what is waiting', () => {
  it('comes back oldest first, so a replay repeats the order they were typed', () => {
    enqueue(entry('third', 300));
    enqueue(entry('first', 100));
    enqueue(entry('second', 200));
    expect(queued().map((e) => e.clientId)).toEqual(['first', 'second', 'third']);
  });

  it('is scoped to one group when asked', () => {
    enqueue(entry('mine', 100, 'g1'));
    enqueue(entry('theirs', 200, 'g2'));
    expect(queued('g1').map((e) => e.clientId)).toEqual(['mine']);
  });

  it('replaces rather than doubles when the same write is queued again', () => {
    enqueue(entry('same', 100));
    enqueue(entry('same', 200));
    expect(queued()).toHaveLength(1);
  });

  it('treats an unreadable queue as an empty one', () => {
    // Storage is shared with whatever else runs on this origin, and a render must not throw because
    // something left junk behind.
    localStorage.setItem('owewell:outbox', '{not json');
    expect(queued()).toEqual([]);
  });
});

describe('which failures are worth keeping', () => {
  it('keeps a write when the network dropped', () => {
    expect(isOffline(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('keeps a write when the browser says it is offline, whatever the error was', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isOffline(new Error('500'))).toBe(true);
  });

  it('does not keep one the server actually refused', () => {
    expect(isOffline(new Error('Amount must be more than zero.'))).toBe(false);
  });
});

describe('flushing', () => {
  it('sends everything and empties the queue', async () => {
    enqueue(entry('a', 100));
    enqueue(entry('b', 200));
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await flush(send);
    expect(result.sent).toBe(2);
    expect(queued()).toEqual([]);
  });

  /*
   * The rule that keeps a queued dinner from being lost.
   *
   * If the first write cannot reach the server the second one cannot either, so the loop stops with
   * everything still queued. Marching on would burn a dead connection and, worse, an implementation
   * that dropped on failure would lose the lot.
   */
  it('stops at the first network failure and keeps the rest', async () => {
    enqueue(entry('a', 100));
    enqueue(entry('b', 200));
    enqueue(entry('c', 300));
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await flush(send);
    expect(result.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(queued().map((e) => e.clientId)).toEqual(['b', 'c']);
  });

  /*
   * A rejection is permanent, so it leaves the queue.
   *
   * The realistic case: you add an expense offline, somebody else records a payment while you are
   * still out of signal, and by the time your write goes out the ledger is locked. Retrying that
   * forever would be a queue that never drains, so it is dropped and handed back for the UI to say
   * out loud.
   */
  it('drops what the server refused and reports it', async () => {
    enqueue(entry('doomed', 100));
    enqueue(entry('fine', 200));
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Can't change or delete an expense once a payment has been recorded."))
      .mockResolvedValueOnce(undefined);
    const result = await flush(send);
    expect(result.sent).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.entry.clientId).toBe('doomed');
    expect(queued()).toEqual([]);
  });

  it('leaves other groups alone when flushing one', async () => {
    enqueue(entry('mine', 100, 'g1'));
    enqueue(entry('theirs', 200, 'g2'));
    await flush(vi.fn().mockResolvedValue(undefined), 'g1');
    expect(queued().map((e) => e.clientId)).toEqual(['theirs']);
  });
});

describe('dropping', () => {
  it('removes just the one', () => {
    enqueue(entry('a', 100));
    enqueue(entry('b', 200));
    drop('a');
    expect(queued().map((e) => e.clientId)).toEqual(['b']);
  });
});

/*
 * Deletes, which are queued on different terms from creates.
 *
 * A create needs an idempotency key so a replay is recognised. A delete needs none: it is repeatable
 * by nature, and the failure mode a key would prevent — doing it twice — is the outcome anyway.
 */
describe('a queued delete', () => {
  const del = (clientId: string, expenseId: string) => ({
    clientId,
    groupId: 'g1',
    kind: 'delete' as const,
    expenseId,
    description: 'Dinner',
    queuedAt: 100,
  });

  it('is told apart from a create', () => {
    enqueue(del('d1', 'e1'));
    enqueue(entry('c1', 200));
    const all = queued();
    expect(all.filter(isDelete).map((e) => e.expenseId)).toEqual(['e1']);
    expect(all.filter(isCreate).map((e) => e.clientId)).toEqual(['c1']);
  });

  it('goes out and leaves the queue', async () => {
    enqueue(del('d1', 'e1'));
    const send = vi.fn().mockResolvedValue(undefined);
    await flush(send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete', expenseId: 'e1' }));
    expect(queued()).toEqual([]);
  });

  /*
   * "Already gone" is success, not failure.
   *
   * Somebody else deleted it, or the first attempt landed and the answer never came back. Either way
   * the queue's job is done, and reporting it as a rejection would tell the person to worry about
   * something that already happened the way they wanted.
   */
  it('recognises a 404 as the job being done', () => {
    expect(isAlreadyDone(new ApiError(404, 'That expense is already gone.'))).toBe(true);
    expect(isAlreadyDone(new ApiError(422, 'Nope.'))).toBe(false);
    expect(isAlreadyDone(new TypeError('Failed to fetch'))).toBe(false);
  });
});

/*
 * Edits, which are the one kind that can come back as a question.
 *
 * A create either lands or is refused. An edit can be refused for a reason the person may want to
 * override — the row moved on while they were offline — so a 409 is separated from the failures that
 * are simply failures.
 */
describe('a queued edit', () => {
  const edit = (clientId: string, expenseId: string) => ({
    clientId,
    groupId: 'g1',
    kind: 'edit' as const,
    expenseId,
    description: 'Dinner',
    amountCents: 5_000,
    queuedAt: 100,
    payload: { ...payload('Dinner'), expectedVersion: 3 },
  });

  it('is told apart from creates and deletes', () => {
    enqueue(edit('e1', 'x1'));
    enqueue(entry('c1', 200));
    const all = queued();
    expect(all.filter(isEdit).map((e) => e.expenseId)).toEqual(['x1']);
    expect(all.filter(isCreate)).toHaveLength(1);
    expect(all.filter(isDelete)).toHaveLength(0);
  });

  it('comes back as a conflict rather than a rejection when the row moved on', async () => {
    enqueue(edit('e1', 'x1'));
    const send = vi.fn().mockRejectedValue(new ApiError(409, 'Somebody changed this expense.'));
    const result = await flush(send);

    expect(result.conflicted.map((e) => e.expenseId)).toEqual(['x1']);
    expect(result.rejected).toEqual([]);
    // Off the queue either way: it cannot be retried as-is, and the caller now owns the question.
    expect(queued()).toEqual([]);
  });

  it('is a plain rejection when the server refused it for any other reason', async () => {
    enqueue(edit('e1', 'x1'));
    const send = vi.fn().mockRejectedValue(new ApiError(422, 'Amount must be more than zero.'));
    const result = await flush(send);
    expect(result.conflicted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('recognises 409 and nothing else as a conflict', () => {
    expect(isConflict(new ApiError(409, 'moved'))).toBe(true);
    expect(isConflict(new ApiError(404, 'gone'))).toBe(false);
    expect(isConflict(new TypeError('Failed to fetch'))).toBe(false);
  });
});

/*
 * Recorded payments, the last write to get an offline path.
 *
 * The easiest of the four, because it appends rather than overwrites: nothing it lands on can be made
 * wrong by the delay, only duplicated, and the server's client id handles that. So there is no
 * conflict case here, unlike an edit.
 */
describe('a queued payment', () => {
  const pay = (clientId: string) => ({
    clientId,
    groupId: 'g1',
    kind: 'settlement' as const,
    description: 'Bob → Alice',
    amountCents: 3_000,
    queuedAt: 100,
    payload: { fromUserId: 'u2', toUserId: 'u1', amountCents: 3_000, clientId },
  });

  it('is told apart from the expense writes', () => {
    enqueue(pay('p1'));
    enqueue(entry('c1', 200));
    const all = queued();
    expect(all.filter(isSettlement)).toHaveLength(1);
    expect(all.filter(isEdit)).toHaveLength(0);
    expect(all.filter(isDelete)).toHaveLength(0);
  });

  /*
   * Both of these show as a row waiting to go out; an edit or a delete changes a row that is already
   * there, so those mark or hide it instead of adding one.
   */
  it('counts as a row to render, alongside creates', () => {
    enqueue(pay('p1'));
    enqueue(entry('c1', 200));
    enqueue({
      clientId: 'd1',
      groupId: 'g1',
      kind: 'delete',
      expenseId: 'e9',
      description: 'Gone',
      queuedAt: 300,
    });
    const rows = queued().filter(isPendingRow);
    expect(rows).toHaveLength(2);
    expect(rows.filter(isCreate)).toHaveLength(1);
  });

  it('goes out and leaves the queue', async () => {
    enqueue(pay('p1'));
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await flush(send);
    expect(result.sent).toBe(1);
    expect(result.conflicted).toEqual([]);
    expect(queued()).toEqual([]);
  });
});
