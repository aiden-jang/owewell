import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drop, enqueue, flush, isOffline, queued } from './outbox';
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
