import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAsyncScope } from './useAsyncScope';
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

/*
 * One group's ledger: five endpoints that are only ever fetched together.
 *
 * The mutators are narrow on purpose. Each exists so something can show before the refetch lands.
 * Don't widen them: the client must never compute balances, or its rounding will disagree with the
 * server's.
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
  /** Take a row off the list on the same tick as the toast, rather than one refetch later. */
  dropExpense: (expenseId: string) => void;
  /** Re-read the outbox after enqueuing or dropping a write. */
  refreshPending: () => void;
  /**
   * Everything queued for this group, however it will land.
   * The sets above mark individual rows; this is the count the page says out loud, because the
   * balances are wrong in a way no single row explains.
   */
  pendingCount: number;
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
  const { begin, invalidate, captureScope } = useAsyncScope(groupId);
  const hasLoaded = useRef(false);
  useLayoutEffect(() => {
    hasLoaded.current = false;
    setGroup(null);
    setBalances([]);
    setExpenses([]);
    setSettlements([]);
    setSuggested([]);
    setNotFound(false);
    setLoadFailed(false);
    setPending(queued(groupId));
  }, [groupId]);

  const fetchAll = useCallback(async (): Promise<{
    balances: Balance[];
    suggested: SuggestedPayment[];
  } | null> => {
    const belongs = captureScope(groupId);
    if (!belongs()) return null;
    const current = begin();
    try {
      const [g, b, e, st, s] = await Promise.all([
        groupsApi.get(groupId),
        groupsApi.balances(groupId),
        expensesApi.list(groupId),
        settlementsApi.list(groupId),
        settlementsApi.suggested(groupId),
      ]);
      if (!belongs()) return null;
      if (current()) {
        hasLoaded.current = true;
        setGroup(g);
        setBalances(b);
        setExpenses(e);
        setSettlements(st);
        setSuggested(s);
      }
      // A post-write receipt still needs its successful snapshot when realtime starts a newer read.
      return { balances: b, suggested: s };
    } catch (error) {
      if (current()) throw error;
      return null;
    }
  }, [groupId, begin, captureScope]);

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
   * Refetches the group, not just the ledger: `archived` drives read-only, so a stale copy leaves
   * edit controls live. Callers use `void refreshLedger()`, so a failure here would be swallowed —
   * keep the view but say it may be behind.
   */
  const refreshLedger = useCallback(async () => {
    try {
      return await fetchAll();
    } catch {
      if (!hasLoaded.current) setLoadFailed(true);
      toast.error('Could not load the latest changes. Reload if the numbers look off.');
      return null;
    }
  }, [fetchAll, toast]);

  const showSavedGroup = useCallback(
    (saved: GroupDetail) => {
      if (!captureScope(groupId)() || saved.id !== groupId) return;
      invalidate();
      hasLoaded.current = true;
      setGroup(saved);
    },
    [captureScope, groupId, invalidate],
  );

  const refreshPending = useCallback(() => setPending(queued(groupId)), [groupId]);

  /*
   * Show a saved expense now; let the refetch catch up. Don't recompute balances here — netting
   * paid against owed is the server's job, and a second implementation would drift from it.
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

  const dropExpense = useCallback((expenseId: string) => {
    setExpenses((current) => current.filter((e) => e.id !== expenseId));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Somebody else changed something: refetch so the numbers on screen are theirs, not ours.
  useGroupRealtime(groupId, () => {
    void refreshLedger();
  });

  // Scoped to this group; the dashboard runs the same hook unscoped so nothing gets stranded.
  useOutboxSync({
    groupId,
    onChanged: () => {
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
   * The row keeps the server's values: the queued payload is form input, not a computed split, so
   * showing it would put a total next to per-person amounts that disagree with it.
   */
  const pendingEdits = useMemo(() => new Set(pending.filter(isEdit).map((e) => e.expenseId)), [pending]);

  return {
    group,
    balances,
    expenses,
    settlements,
    suggested,
    notFound,
    loadFailed,
    pendingRows,
    pendingDeletes,
    pendingEdits,
    load,
    refreshLedger,
    setGroup: showSavedGroup,
    showSavedExpense,
    dropExpense,
    refreshPending,
    pendingCount: pending.length,
  };
}
