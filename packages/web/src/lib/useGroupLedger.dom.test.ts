import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { Expense } from './expenses';
import type { QueuedWrite } from './outbox';

/**
 * One group's ledger, and every reason it changes.
 *
 * None of this could be reached before without rendering the whole page behind a signed-in session,
 * which is why the distinction it exists to protect had never been checked: a 404 means the group is
 * gone and you get the "went missing" screen, while a dropped connection means try again. Conflating
 * them tells somebody their trip was deleted because their train went into a tunnel.
 */

const get = vi.fn();
const balancesApi = vi.fn();
const listExpenses = vi.fn();
const listSettlements = vi.fn();
const suggestedApi = vi.fn();

vi.mock('./groups', () => ({
  groupsApi: { get: (...a: unknown[]) => get(...a), balances: (...a: unknown[]) => balancesApi(...a) },
}));
vi.mock('./expenses', () => ({ expensesApi: { list: (...a: unknown[]) => listExpenses(...a) } }));
vi.mock('./settlements', () => ({
  settlementsApi: { list: (...a: unknown[]) => listSettlements(...a), suggested: (...a: unknown[]) => suggestedApi(...a) },
}));

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));
vi.mock('./sound', () => ({ play: vi.fn() }));

// Captured so the tests can fire the two things that change the ledger from outside.
let fireRealtime: () => void = () => {};
let fireDrained: () => void = () => {};
let fireQueueChanged: () => void = () => {};
vi.mock('../hooks/useGroupRealtime', () => ({
  useGroupRealtime: (_id: string, onChange: () => void) => { fireRealtime = onChange; },
}));
vi.mock('./useOutboxSync', () => ({
  useOutboxSync: ({ onChanged, onQueueChanged }: { onChanged: () => void; onQueueChanged: () => void }) => {
    fireDrained = onChanged;
    fireQueueChanged = onQueueChanged;
  },
}));

let outbox: QueuedWrite[] = [];
vi.mock('./outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./outbox')>()),
  queued: () => outbox,
}));

const expense = (id: string, description: string): Expense => ({
  id, description, amountCents: 1_000, payerId: 'a', splitMethod: 'EQUAL', category: 'food',
  createdAt: '2026-08-10T12:00:00.000Z', date: '2026-08-10T12:00:00.000Z', note: null,
  version: 1, splits: [{ userId: 'a', owedCents: 1_000 }],
});

const GROUP = { id: 'g1', name: 'Tahoe', members: [], archived: false } as never;
const BALANCES = [{ userId: 'a', displayName: 'Alice', netCents: 500, paidCents: 500, owedCents: 0 }];
const SUGGESTED = [{ fromUserId: 'b', fromName: 'Bob', toUserId: 'a', toName: 'Alice', amountCents: 500 }];

function serveOk(): void {
  get.mockResolvedValue(GROUP);
  balancesApi.mockResolvedValue(BALANCES);
  listExpenses.mockResolvedValue([expense('e1', 'Dinner')]);
  listSettlements.mockResolvedValue([]);
  suggestedApi.mockResolvedValue(SUGGESTED);
}

async function open(groupId = 'g1') {
  const { useGroupLedger } = await import('./useGroupLedger');
  const view = renderHook(({ id }) => useGroupLedger(id), { initialProps: { id: groupId } });
  await waitFor(() => expect(get).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  outbox = [];
  for (const fn of [get, balancesApi, listExpenses, listSettlements, suggestedApi]) fn.mockReset();
  toastStub.error.mockReset();
  serveOk();
});

/*
 * Deliberately no vi.resetModules(): the hook's `err instanceof ApiError` compares against the class
 * from ./api, and resetting modules between tests hands the hook a second copy of that module. The
 * instanceof then fails for every error, every 404 falls through to the "hiccup" branch, and the
 * tests that assert the hiccup branch pass for entirely the wrong reason.
 */

describe('loading', () => {
  it('fetches the whole ledger for the group it was given', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));
    expect(get).toHaveBeenCalledWith('g1');
    expect(result.current.group).toBe(GROUP);
    expect(result.current.balances).toBe(BALANCES);
    expect(result.current.suggested).toBe(SUGGESTED);
  });

  it('refetches when the page moves to another group', async () => {
    const { result, rerender } = await open();
    await waitFor(() => expect(result.current.group).toBe(GROUP));
    rerender({ id: 'g2' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('g2'));
  });
});

describe('the two ways loading fails', () => {
  /*
   * The distinction this hook exists to keep straight. A 404 or 403 means the group is gone or was
   * never yours, and the page says so; anything else is a hiccup that deserves a retry button.
   */
  it.each([404, 403])('calls a %i a group that is not there', async (status) => {
    get.mockRejectedValue(new ApiError(status, 'nope'));
    const { result } = await open();
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.loadFailed).toBe(false);
  });

  it.each([500, 502])('calls a %i a hiccup, not a missing group', async (status) => {
    get.mockRejectedValue(new ApiError(status, 'boom'));
    const { result } = await open();
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.notFound).toBe(false);
  });

  // A dropped connection throws a TypeError rather than an ApiError, and must not read as deleted.
  it('calls a dead connection a hiccup too', async () => {
    get.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await open();
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.notFound).toBe(false);
  });

  it('clears the failure before trying again', async () => {
    get.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await open();
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    serveOk();
    await act(() => result.current.load());
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.group).toBe(GROUP);
  });
});

describe('refreshing after a write', () => {
  it('hands back the new balances so the caller can build a receipt', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.group).toBe(GROUP));

    let out: unknown;
    await act(async () => { out = await result.current.refreshLedger(); });
    expect(out).toEqual({ balances: BALANCES, suggested: SUGGESTED });
  });

  /*
   * Callers fire this as `void refreshLedger()`, so a silent rejection would leave a change that
   * just succeeded sitting on top of stale numbers with nothing on screen to say so. The view it
   * already has is still valid, so it stays; the person is told it may be behind.
   */
  it('keeps what it has and says so when the refetch fails', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));

    get.mockRejectedValue(new TypeError('Failed to fetch'));
    let out: unknown = 'unset';
    await act(async () => { out = await result.current.refreshLedger(); });
    expect(out).toBeNull();
    expect(toastStub.error).toHaveBeenCalledWith(expect.stringContaining('Could not load the latest'));
    expect(result.current.expenses).toHaveLength(1);
    // Not a "went missing" screen: a failed refresh is not a deleted group.
    expect(result.current.notFound).toBe(false);
  });
});

describe('changes that arrive from outside', () => {
  it('refetches when somebody else edits the group', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.group).toBe(GROUP));
    get.mockClear();

    await act(async () => { fireRealtime(); });
    await waitFor(() => expect(get).toHaveBeenCalled());
  });

  it('refetches when a queued write finally lands', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.group).toBe(GROUP));
    get.mockClear();

    await act(async () => { fireDrained(); });
    await waitFor(() => expect(get).toHaveBeenCalled());
  });
});

describe('showing a change before the server confirms it', () => {
  it('puts a new expense at the top', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));

    act(() => result.current.showSavedExpense(expense('e2', 'Cab home')));
    expect(result.current.expenses.map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  // An edit is the same call, and must replace in place rather than appear as a second row.
  it('replaces an expense it already has, where it already is', async () => {
    listExpenses.mockResolvedValue([expense('e1', 'Dinner'), expense('e2', 'Cab home')]);
    const { result } = await open();
    await waitFor(() => expect(result.current.expenses).toHaveLength(2));

    act(() => result.current.showSavedExpense(expense('e1', 'Dinner at Nopa')));
    expect(result.current.expenses.map((e) => e.description)).toEqual(['Dinner at Nopa', 'Cab home']);
  });

  it('drops a row on the same tick as the toast', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));

    act(() => result.current.dropExpense('e1'));
    expect(result.current.expenses).toHaveLength(0);
  });
});

describe('writes still waiting to go out', () => {
  const queuedCreate = { clientId: 'q1', groupId: 'g1', kind: 'expense', description: 'Ferry', amountCents: 900, queuedAt: 1, payload: {} } as unknown as QueuedWrite;
  const queuedDelete = { clientId: 'q2', groupId: 'g1', kind: 'delete', description: 'Cab', expenseId: 'e1', queuedAt: 2 } as unknown as QueuedWrite;
  const queuedEdit = { clientId: 'q3', groupId: 'g1', kind: 'edit', description: 'Dinner', expenseId: 'e9', queuedAt: 3, payload: {} } as unknown as QueuedWrite;

  it('sorts them into the three things a row can be', async () => {
    outbox = [queuedCreate, queuedDelete, queuedEdit];
    const { result } = await open();
    await waitFor(() => expect(result.current.group).toBe(GROUP));

    expect(result.current.pendingRows.map((e) => e.clientId)).toEqual(['q1']);
    expect([...result.current.pendingDeletes]).toEqual(['e1']);
    expect([...result.current.pendingEdits]).toEqual(['e9']);
  });

  it('re-reads the queue when told it moved', async () => {
    const { result } = await open();
    await waitFor(() => expect(result.current.pendingRows).toHaveLength(0));

    outbox = [queuedCreate];
    act(() => fireQueueChanged());
    expect(result.current.pendingRows).toHaveLength(1);
  });

  /*
   * The Sets are memoised on the queue, not rebuilt each render: the feed's own memos depend on
   * their identity, and a fresh Set every time would make every keystroke in the search box
   * recompute the whole activity list.
   */
  it('keeps the same Sets while the queue has not moved', async () => {
    outbox = [queuedDelete];
    const { result, rerender } = await open();
    await waitFor(() => expect(result.current.pendingDeletes.size).toBe(1));

    const before = result.current.pendingDeletes;
    rerender({ id: 'g1' });
    expect(result.current.pendingDeletes).toBe(before);
  });
});
