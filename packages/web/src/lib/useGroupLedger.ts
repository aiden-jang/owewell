import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from './api';
import { groupsApi, type Balance, type GroupDetail } from './groups';
import { expensesApi, type Expense } from './expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from './settlements';
import {
  isDelete,
  isEdit,
  isPendingRow,
  queued,
  type QueuedCreate,
  type QueuedSettlement,
  type QueuedWrite,
} from './outbox';
import { useGroupRealtime } from '../hooks/useGroupRealtime';
import { useOutboxSync } from './useOutboxSync';
import { useToast } from '../components/Toast';
import { play } from './sound';

/*
 * One group's ledger: what it is, and every reason it changes.
 *
 * Five endpoints that are only ever fetched together, plus the three things that can make them
 * stale behind your back — your own writes, somebody else's writes arriving over the socket, and a
 * queued write finally reaching the server. Held together because a page holding seven pieces of
 * state that always move at the same time is really holding one.
 *
 * The mutators are deliberately narrow rather than handing back the setters. Each exists because
 * something has to show on screen before the refetch catches up: a saved row, a deleted row, a
 * photo. Anything wider and the page could start computing balances itself, which is the server's
 * job and a rounding difference waiting to happen.
 */

export interface GroupLedger {
  group: GroupDetail | null;
  balances: Balance[];
  expenses: Expense[];
  settlements: Settlement[];
  suggested: SuggestedPayment[];
  /** Gone, or never yours. Distinct from a failed request. */
  notFound: boolean;
  /** A transient failure that deserves a retry rather than a "went missing" screen. */
  loadFailed: boolean;
  /** Queued creates and payments, the only two kinds that draw a row of their own. */
  pendingRows: (QueuedCreate | QueuedSettlement)[];
  /** Expense ids with a queued delete: gone from the feed before the server knows. */
  pendingDeletes: Set<string>;
  /** Expense ids with a queued edit: still showing the server's values, and saying so. */
  pendingEdits: Set<string>;
  load: () => Promise<void>;
  /** Refetch everything. Returns the new balances and transfers, or null if the refetch failed. */
  refreshLedger: () => Promise<{ balances: Balance[]; suggested: SuggestedPayment[] } | null>;
  setGroup: (group: GroupDetail) => void;
  /** Put a just-saved expense on screen, replacing the old version of it if there is one. */
  showSavedExpense: (saved: Expense) => void;
  /** Change one field on one row, for things the refetch would only confirm (a receipt photo). */
  patchExpense: (expenseId: string, patch: Partial<Expense>) => void;
  /** Take a row off the list on the same tick as the toast, rather than one refetch later. */
  dropExpense: (expenseId: string) => void;
  /** Re-read the outbox after enqueuing or dropping a write. */
  refreshPending: () => void;
}

export function useGroupLedger(groupId: string): GroupLedger {
  const toast = useToast();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [suggested, setSuggested] = useState<SuggestedPayment[]>([]);
  const [notFound, setNotFound] = useState(false);
  // A transient load failure (network / 5xx) is distinct from a real 404/403: the former gets a
  // retry, the latter the "went missing" state. Don't conflate a hiccup with a deleted group.
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<QueuedWrite[]>(() => queued(groupId));

  const fetchAll = useCallback(async (): Promise<{ balances: Balance[]; suggested: SuggestedPayment[] }> => {
    const [g, b, e, st, s] = await Promise.all([
      groupsApi.get(groupId),
      groupsApi.balances(groupId),
      expensesApi.list(groupId),
      settlementsApi.list(groupId),
      settlementsApi.suggested(groupId),
    ]);
    setGroup(g);
    setBalances(b);
    setExpenses(e);
    setSettlements(st);
    setSuggested(s);
    return { balances: b, suggested: s };
  }, [groupId]);

  const load = useCallback(async (): Promise<void> => {
    setNotFound(false);
    setLoadFailed(false);
    try {
      await fetchAll();
    } catch (err) {
      // Genuine "not yours / gone" only for 404/403; anything else is a transient failure.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setNotFound(true);
      } else {
        setLoadFailed(true);
      }
    }
  }, [fetchAll]);

  /*
   * Refetches the group too, not just the ledger.
   *
   * If it was archived, renamed, or had a member change in another tab, `group.archived` (which
   * drives read-only) and the member list must stay current, or stale gates keep edit controls live.
   *
   * Callers fire this as `void refreshLedger()`, so a failed refetch would otherwise be a swallowed
   * rejection leaving a just-succeeded change showing over stale data. Keep the current view — it is
   * still valid — but say it may be behind.
   */
  const refreshLedger = useCallback(async () => {
    try {
      return await fetchAll();
    } catch {
      toast.error('Could not load the latest changes. Reload if the numbers look off.');
      return null;
    }
  }, [fetchAll, toast]);

  const refreshPending = useCallback(() => setPending(queued(groupId)), [groupId]);

  /*
   * Put a saved expense on screen now, and let the ledger catch up behind it.
   *
   * The refetch pulls five endpoints, so waiting for it meant the row a person just typed appeared a
   * whole extra round trip after the save. Balances are deliberately NOT recomputed here: netting
   * paid against owed (per-item payers, tax and tip apportioned across shares) is the server's job,
   * and a second implementation of it on the client is a rounding difference waiting to happen. The
   * hero number counts up over 650ms anyway, so it landing a beat later reads as the animation.
   */
  const showSavedExpense = useCallback((saved: Expense) => {
    setExpenses((current) => {
      const i = current.findIndex((e) => e.id === saved.id);
      if (i === -1) return [saved, ...current];
      const next = [...current];
      next[i] = saved;
      return next;
    });
  }, []);

  const patchExpense = useCallback((expenseId: string, patch: Partial<Expense>) => {
    setExpenses((current) => current.map((e) => (e.id === expenseId ? { ...e, ...patch } : e)));
  }, []);

  const dropExpense = useCallback((expenseId: string) => {
    setExpenses((current) => current.filter((e) => e.id !== expenseId));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Somebody else changed something. The sound is the only notice you get, since the numbers just
  // move underneath you.
  useGroupRealtime(groupId, () => {
    play('nudge');
    void refreshLedger();
  });

  /*
   * Sending what is waiting.
   *
   * Scoped to this group, because this is the screen with the ledger on it to refresh. The dashboard
   * runs the same hook unscoped, so a write queued here still goes out even if the next thing you
   * open is a different group.
   */
  useOutboxSync({
    groupId,
    onChanged: () => {
      play('add');
      void refreshLedger();
    },
    onQueueChanged: refreshPending,
  });

  // Creates and recorded payments both show as a row waiting to go out; edits and deletes change
  // rows that already exist, so they mark or hide those instead.
  const pendingRows = useMemo(() => pending.filter(isPendingRow), [pending]);
  // Memoised: a fresh Set every render would defeat the memos in the feed that depend on it.
  const pendingDeletes = useMemo(() => new Set(pending.filter(isDelete).map((e) => e.expenseId)), [pending]);
  /*
   * Rows with an edit still in the queue.
   *
   * The row keeps showing what the server has, because the queued payload is a set of form values
   * rather than a computed split: pretending otherwise would mean a total that disagreed with the
   * per-person amounts underneath it. So it says the change is waiting instead of faking it.
   */
  const pendingEdits = useMemo(() => new Set(pending.filter(isEdit).map((e) => e.expenseId)), [pending]);

  return {
    group, balances, expenses, settlements, suggested,
    notFound, loadFailed,
    pendingRows, pendingDeletes, pendingEdits,
    load, refreshLedger, setGroup,
    showSavedExpense, patchExpense, dropExpense, refreshPending,
  };
}
