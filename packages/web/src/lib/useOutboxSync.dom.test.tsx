import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiError } from './api';
import { enqueue, queued, type QueuedEdit, type QueuedWrite } from './outbox';

/**
 * Draining the outbox, driven. The forms cover the enqueue side; this is the half that re-sends,
 * and its rules only bite in conditions nobody reproduces by hand — a doubled flush, a conflict
 * that can never land, a delete of something already gone.
 */

const flush = vi.fn();
const subscribe = vi.fn<(fn: () => void) => () => void>(() => () => {});
vi.mock('./outbox', async () => {
  const actual = await vi.importActual<typeof import('./outbox')>('./outbox');
  return {
    ...actual,
    flush: (send: (e: QueuedWrite) => Promise<unknown>, groupId?: string, ownerId?: string) =>
      flush(send, groupId, ownerId),
    subscribe: (fn: () => void) => subscribe(fn),
  };
});

const api = {
  list: vi.fn(),
  create: vi.fn(),
  createItemized: vi.fn(),
  update: vi.fn(),
  updateItemized: vi.fn(),
  remove: vi.fn(),
};
vi.mock('./expenses', () => ({ expensesApi: api }));

const record = vi.fn();
vi.mock('./settlements', () => ({
  settlementsApi: { record: (g: string, p: unknown, ownerId: string) => record(g, p, ownerId) },
}));

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));

const confirmStub = vi.fn();
vi.mock('../components/Confirm', () => ({ useConfirm: () => confirmStub }));

const base = { ownerId: 'u1', clientId: 'c1', groupId: 'g1', description: 'Dinner', queuedAt: 0 };
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
const nothing = { sent: 0, conflicted: [] };
const ledger = { id: 'e1', description: 'Dinner on the ledger', amountCents: 250, version: 4 };

async function mount(props: Record<string, unknown> = {}) {
  const { useOutboxSync } = await import('./useOutboxSync');
  const onChanged = vi.fn();
  const onQueueChanged = vi.fn();
  const view = renderHook(() => useOutboxSync({ ownerId: 'u1', onChanged, onQueueChanged, ...props }));
  return { ...view, onChanged, onQueueChanged };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  flush.mockResolvedValue(nothing);
  confirmStub.mockResolvedValue(false);
  api.list.mockResolvedValue([ledger]);
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
    expect(record).toHaveBeenCalledWith('g1', { x: 1 }, 'u1');
  });

  it('sends a plain create to create, and an itemized one to createItemized', async () => {
    await send({ ...base, kind: 'expense', amountCents: 1, payload: { a: 1 } } as unknown as QueuedWrite);
    expect(api.create).toHaveBeenCalledWith('g1', { a: 1 }, 'u1');
    await send({ ...base, kind: 'itemized', amountCents: 1, payload: { b: 2 } } as unknown as QueuedWrite);
    expect(api.createItemized).toHaveBeenCalledWith('g1', { b: 2 }, 'u1');
  });

  it('sends each kind of edit to its own update', async () => {
    await send(edit());
    expect(api.update).toHaveBeenCalledWith(
      'g1',
      'e1',
      expect.objectContaining({ expectedVersion: 3 }),
      'u1',
    );
    await send(edit({ kind: 'edit-itemized' }));
    expect(api.updateItemized).toHaveBeenCalledWith('g1', 'e1', expect.anything(), 'u1');
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

  it('shows a previous rejected write after reopening and scopes it to the signed-in account', async () => {
    const saved = edit({ failure: 'Too long.' });
    enqueue(saved);
    enqueue(edit({ clientId: 'other', ownerId: 'u2', failure: 'Not yours.' }));
    const { result } = await mount();
    expect(result.current.failed).toEqual([saved]);
  });
});

describe('an edit that conflicted while it waited', () => {
  it('keeps the edit when the conflict dialog is dismissed without a decision', async () => {
    const saved = edit();
    enqueue(saved);
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [saved] });
    confirmStub.mockImplementationOnce(async ({ onDismiss }) => {
      onDismiss();
      return false;
    });
    const { result } = await mount();
    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(queued()).toEqual([saved]);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('asks, and does nothing if you keep theirs', async () => {
    enqueue(edit());
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(false);
    await mount();
    await waitFor(() => expect(confirmStub).toHaveBeenCalled());
    expect(api.update).not.toHaveBeenCalled();
  });

  it('sends against the ledger version shown in the prompt', async () => {
    enqueue(edit());
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(true);
    const { onChanged } = await mount();
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const payload = api.update.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload).toMatchObject({ description: 'Dinner', expectedVersion: 4 });
    expect(confirmStub.mock.calls[0]![0].body).toContain('“Dinner on the ledger” for $2.50');
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends an itemized conflict to the itemized update', async () => {
    const receiptEdit = edit({ kind: 'edit-itemized' });
    enqueue(receiptEdit);
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [receiptEdit] });
    confirmStub.mockResolvedValue(true);
    await mount();
    await waitFor(() => expect(api.updateItemized).toHaveBeenCalled());
    expect(api.updateItemized.mock.calls[0]![2]).toMatchObject({ expectedVersion: 4 });
  });

  it('keeps the queued edit when it cannot load a version to review', async () => {
    const saved = edit();
    enqueue(saved);
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [saved] });
    api.list.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    const { result } = await mount();
    await waitFor(() => expect(result.current.paused).toBe('sign-in'));
    expect(confirmStub).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(queued()).toEqual([saved]);
  });

  // Asked in order and one at a time: answering the first can be what makes the second make sense.
  it('asks about each one, in order', async () => {
    const first = edit({ description: 'First' });
    const second = edit({ clientId: 'c2', description: 'Second' });
    enqueue(first);
    enqueue(second);
    flush
      .mockResolvedValueOnce({ ...nothing, conflicted: [first] })
      .mockResolvedValueOnce({ ...nothing, conflicted: [second] });
    await mount();
    await waitFor(() => expect(confirmStub).toHaveBeenCalledTimes(2));
    expect(confirmStub.mock.calls[0]![0].title).toContain('First');
    expect(confirmStub.mock.calls[1]![0].title).toContain('Second');
  });

  it('says so when applying yours also fails', async () => {
    enqueue(edit());
    flush.mockResolvedValueOnce({ ...nothing, conflicted: [edit()] });
    confirmStub.mockResolvedValue(true);
    api.update.mockRejectedValue(new ApiError(503, 'Still no.'));
    const view = await mount();
    await waitFor(() => expect(view.result.current.paused).toBe('temporary'));
    expect(toastStub.error).toHaveBeenCalledWith('Could not apply your version. Your edit is still waiting.');
    expect(queued(undefined, 'u1')).toEqual([edit()]);
  });
});

describe('how often it runs', () => {
  it('scopes to one group when given one, and drains everything otherwise', async () => {
    await mount({ groupId: 'g7' });
    await waitFor(() => expect(flush).toHaveBeenCalledWith(expect.any(Function), 'g7', 'u1'));
    vi.clearAllMocks();
    flush.mockResolvedValue(nothing);
    await mount();
    await waitFor(() => expect(flush).toHaveBeenCalledWith(expect.any(Function), undefined, 'u1'));
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
