import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiError } from './api';
import type { QueuedEdit, QueuedWrite } from './outbox';

/**
 * Draining the outbox, driven.
 *
 * The enqueue side is covered by the forms; this is the half that actually re-sends, and it is
 * where the interesting failures are. Four of its rules only ever bite in conditions nobody
 * reproduces by hand:
 *
 *   1. One flush at a time. A flaky connection fires `online` repeatedly and mount can overlap a
 *      reconnect, so two passes would post the same entry twice.
 *   2. A queued delete that finds nothing to delete got what it wanted. Reporting that as a failure
 *      asks somebody to fix something that is already correct.
 *   3. A conflict is a question. "Apply mine" has to re-send WITHOUT expectedVersion, or it
 *      conflicts against the very change it was just told about and can never land.
 *   4. A rejection is named, because it has left the queue and only the person can retype it.
 */

const flush = vi.fn();
const subscribe = vi.fn<(fn: () => void) => () => void>(() => () => {});
vi.mock('./outbox', async () => {
  const actual = await vi.importActual<typeof import('./outbox')>('./outbox');
  return {
    ...actual,
    flush: (send: (e: QueuedWrite) => Promise<unknown>, groupId?: string) => flush(send, groupId),
    subscribe: (fn: () => void) => subscribe(fn),
  };
});

const api = {
  create: vi.fn(),
  createItemized: vi.fn(),
  update: vi.fn(),
  updateItemized: vi.fn(),
  remove: vi.fn(),
};
vi.mock('./expenses', () => ({ expensesApi: api }));

const record = vi.fn();
vi.mock('./settlements', () => ({ settlementsApi: { record: (g: string, p: unknown) => record(g, p) } }));

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));

const confirmStub = vi.fn();
vi.mock('../components/Confirm', () => ({ useConfirm: () => confirmStub }));

const base = { clientId: 'c1', groupId: 'g1', description: 'Dinner', queuedAt: 0 };
const edit = (over: Partial<QueuedEdit> = {}): QueuedEdit =>
  ({
    ...base,
    kind: 'edit',
    expenseId: 'e1',
    amountCents: 100,
    payload: { expectedVersion: 3, description: 'Dinner' },
    ...over,
  }) as QueuedEdit;

/** Nothing queued, unless a test says otherwise. */
const nothing = { sent: 0, rejected: [], conflicted: [] };

async function mount(props: Record<string, unknown> = {}) {
  const { useOutboxSync } = await import('./useOutboxSync');
  const onChanged = vi.fn();
  const onQueueChanged = vi.fn();
  const view = renderHook(() => useOutboxSync({ onChanged, onQueueChanged, ...props }));
  return { ...view, onChanged, onQueueChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  flush.mockResolvedValue(nothing);
  confirmStub.mockResolvedValue(false);
});

describe('which call each queued kind turns into', () => {
  /*
   * Driven through the real `sendQueuedWrite` by handing the mocked flush the send function the
   * hook gives it. Routing a kind to the wrong endpoint is invisible until somebody goes offline.
   */
  const send = async (entry: QueuedWrite): Promise<void> => {
    let captured: ((e: QueuedWrite) => Promise<unknown>) | undefined;
    flush.mockImplementation(async (fn: (e: QueuedWrite) => Promise<unknown>) => {
      captured = fn;
      return nothing;
    });
    await mount();
    await waitFor(() => expect(captured).toBeDefined());
    await captured!(entry);
  };

  it('sends a queued settlement to the settlements endpoint', async () => {
    await send({
      ...base,
      kind: 'settlement',
      amountCents: 500,
      payload: { x: 1 },
    } as unknown as QueuedWrite);
    expect(record).toHaveBeenCalledWith('g1', { x: 1 });
  });

  it('sends a plain create to create, and an itemized one to createItemized', async () => {
    await send({ ...base, kind: 'expense', amountCents: 1, payload: { a: 1 } } as unknown as QueuedWrite);
    expect(api.create).toHaveBeenCalledWith('g1', { a: 1 });
    await send({ ...base, kind: 'itemized', amountCents: 1, payload: { b: 2 } } as unknown as QueuedWrite);
    expect(api.createItemized).toHaveBeenCalledWith('g1', { b: 2 });
  });

  it('sends each kind of edit to its own update', async () => {
    await send(edit());
    expect(api.update).toHaveBeenCalledWith('g1', 'e1', expect.objectContaining({ expectedVersion: 3 }));
    await send(edit({ kind: 'edit-itemized' }));
    expect(api.updateItemized).toHaveBeenCalledWith('g1', 'e1', expect.anything());
  });

  // Already gone is the outcome the delete wanted, so it leaves the queue quietly.
  it('treats a delete of something already deleted as done', async () => {
    api.remove.mockRejectedValue(new ApiError(404, 'gone'));
    await expect(
      send({ ...base, kind: 'delete', expenseId: 'e1' } as unknown as QueuedWrite),
    ).resolves.toBeUndefined();
  });

  it('still surfaces a delete that failed for any other reason', async () => {
    api.remove.mockRejectedValue(new ApiError(500, 'boom'));
    await expect(
      send({ ...base, kind: 'delete', expenseId: 'e1' } as unknown as QueuedWrite),
    ).rejects.toThrow('boom');
  });
});

describe('what it says when things land', () => {
  it('says nothing at all when the queue was empty', async () => {
    const { onChanged } = await mount();
    await waitFor(() => expect(flush).toHaveBeenCalled());
    expect(toastStub.success).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'Sent the change that was waiting.'],
    [3, 'Sent 3 waiting changes.'],
  ])('counts %i sent', async (sent, message) => {
    flush.mockResolvedValue({ ...nothing, sent });
    const { onChanged } = await mount();
    await waitFor(() => expect(toastStub.success).toHaveBeenCalledWith(message));
    expect(onChanged).toHaveBeenCalled();
  });

  // It is out of the queue and only the person can retype it, so it has to be named.
  it('names a write the server refused', async () => {
    flush.mockResolvedValue({ ...nothing, rejected: [{ entry: edit(), message: 'Too long.' }] });
    await mount();
    await waitFor(() =>
      expect(toastStub.error).toHaveBeenCalledWith('"Dinner" could not be saved: Too long.'),
    );
  });
});

describe('an edit that conflicted while it waited', () => {
  it('asks, and does nothing if you keep theirs', async () => {
    flush.mockResolvedValue({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(false);
    await mount();
    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    expect(api.update).not.toHaveBeenCalled();
  });

  /*
   * The subtle one. Re-sending with the version it was based on would conflict against the change
   * it was just told about, so "Apply mine" would never be able to land.
   */
  it('re-sends without the version when you apply yours', async () => {
    flush.mockResolvedValue({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(true);
    const { onChanged } = await mount();
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const payload = api.update.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('expectedVersion');
    expect(payload).toMatchObject({ description: 'Dinner' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends an itemized conflict to the itemized update', async () => {
    flush.mockResolvedValue({ ...nothing, conflicted: [edit({ kind: 'edit-itemized' })] });
    confirmStub.mockResolvedValue(true);
    await mount();
    await waitFor(() => expect(api.updateItemized).toHaveBeenCalled());
    expect(api.updateItemized.mock.calls[0]![2]).not.toHaveProperty('expectedVersion');
  });

  // Asked in order and one at a time: answering the first can be what makes the second make sense.
  it('asks about each one, in order', async () => {
    flush.mockResolvedValue({
      ...nothing,
      conflicted: [edit({ description: 'First' }), edit({ description: 'Second' })],
    });
    await mount();
    await waitFor(() => expect(confirmStub).toHaveBeenCalledTimes(2));
    expect(confirmStub.mock.calls[0]![0].title).toContain('First');
    expect(confirmStub.mock.calls[1]![0].title).toContain('Second');
  });

  it('says so when applying yours also fails', async () => {
    flush.mockResolvedValue({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(true);
    api.update.mockRejectedValue(new Error('Still no.'));
    await mount();
    await waitFor(() => expect(toastStub.error).toHaveBeenCalledWith('Still no.'));
  });
});

describe('how often it runs', () => {
  it('scopes to one group when given one, and drains everything otherwise', async () => {
    await mount({ groupId: 'g7' });
    await waitFor(() => expect(flush).toHaveBeenCalledWith(expect.any(Function), 'g7'));
    vi.clearAllMocks();
    flush.mockResolvedValue(nothing);
    await mount();
    await waitFor(() => expect(flush).toHaveBeenCalledWith(expect.any(Function), undefined));
  });

  it('flushes again when the connection comes back', async () => {
    await mount();
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
  });

  /*
   * The overlap guard. Two passes over the same queue post the same entry twice: the client ids
   * stop that becoming two expenses, but it is still a wasted round trip and two identical toasts.
   */
  it('will not start a second pass while one is still running', async () => {
    let release: () => void = () => {};
    flush.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(nothing);
        }),
    );
    await mount();
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(flush).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  });

  it('stops listening once the screen is gone', async () => {
    const { unmount } = await mount();
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    unmount();
    window.dispatchEvent(new Event('online'));
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
