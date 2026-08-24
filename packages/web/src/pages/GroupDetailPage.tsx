import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CURRENCIES,
  currencyFormatter,
  DEFAULT_CURRENCY,
} from '@owewell/shared';
import {
  PAYMENT_METHOD_LABELS,
  categoryMeta,
  type PaymentMethod,
} from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { InviteLink } from '../components/InviteLink';
import { MoneyText } from '../components/MoneyText';
import { Sheet } from '../components/Sheet';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { RecordPaymentForm } from '../components/RecordPaymentForm';
import { SettleUpPanel } from '../components/SettleUpPanel';
import { MembersPanel, type PaymentHandles } from '../components/MembersPanel';
import { ActivityFeed } from '../components/ActivityFeed';
import { SummaryTab } from '../components/SummaryTab';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { groupsApi, type Balance, type GroupDetail, type GroupSummary } from '../lib/groups';
import { expensesApi, receiptUrl, type Expense } from '../lib/expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { ApiError } from '../lib/api';
import { useGroupRealtime } from '../hooks/useGroupRealtime';
import { play } from '../lib/sound';
import { ExpenseDetail } from '../components/ExpenseDetail';
import { CurrencyProvider } from '../lib/currency';
import {
  drop as dropWrite,
  enqueue as enqueueWrite,
  isDelete,
  isEdit,
  isPendingRow,
  isOffline,
  queued as outboxQueued,
  type QueuedWrite,
} from '../lib/outbox';
import { useOutboxSync } from '../lib/useOutboxSync';
import { pulseLabel, spendingPulse } from '../lib/spendingPulse';
import { buildSettlementReceipt, type SettlementReceiptData } from '../lib/settlementReceipt';
import { SettlementReceipt } from '../components/SettlementReceipt';
import { SettledMark } from '../components/SettledMark';
import { buildGroupRecap } from '../lib/groupRecap';

function csvCell(value: string | number): string {
  // Spreadsheet apps execute leading formula characters even inside imported CSV files. User
  // controlled descriptions and names must stay text when the export is opened in Excel/Sheets.
  const raw = String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex-1">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl animate-rise px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8">
        {children}
      </main>
    </div>
  );
}

export function GroupDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [suggested, setSuggested] = useState<SuggestedPayment[]>([]);
  const [notFound, setNotFound] = useState(false);
  // A transient load failure (network / 5xx) is distinct from a real 404/403: the former gets a
  // retry, the latter the "went missing" state. Don't conflate a hiccup with a deleted group.
  const [loadFailed, setLoadFailed] = useState(false);
  const [settling, setSettling] = useState(false);
  const [expenseMode, setExpenseMode] = useState<'simple' | 'itemized'>('simple');
  const [sheetOpen, setSheetOpen] = useState(false);
  // All the viewer's groups, for the header switcher. Fetched once; the list rarely changes.
  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // A "person lens" over both the breakdown and the feed: pick a person, then how they relate to
  // an expense — involved (paid or owe a share) / owes (a share they didn't pay) / paid. Null
  // person = no lens. Category is a separate drill-down from the chart into the feed only.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // "Where it went" can render as bars (default, easiest to compare) or a part-to-whole donut.
  /*
   * Two questions, two tabs: "what do I owe" and "how did we spend".
   *
   * Everything used to be one column, and it had grown to eight cards with their own headings and
   * their own chrome, which is more than a person can hold while deciding whether to send somebody
   * $70. The balance and the tab bar stay put; only what's under them swaps.
   *
   * It lives in the URL so a reload, a back button, or a link keeps the view you were on.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'activity' | 'summary' = searchParams.get('view') === 'summary' ? 'summary' : 'activity';
  const setTab = (next: 'activity' | 'summary'): void => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'activity') params.delete('view');
        else params.set('view', next);
        return params;
      },
      { replace: true },
    );
  };
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [duplicatingExpense, setDuplicatingExpense] = useState<Expense | null>(null);
  // Held by id, not by value: an edit or a realtime refetch replaces the object in `expenses`, and the
  // open sheet has to follow it. A deleted expense drops out of the list, which closes the sheet.
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [pending, setPending] = useState<QueuedWrite[]>(() => outboxQueued(id));
  // Creates and recorded payments both show as a row waiting to go out; edits and deletes change
  // rows that already exist, so they mark or hide those instead.
  const pendingRows = pending.filter(isPendingRow);
  // Memoised: a fresh Set every render would defeat the activity memo below that depends on it.
  const pendingDeletes = useMemo(
    () => new Set(pending.filter(isDelete).map((e) => e.expenseId)),
    [pending],
  );
  /*
   * Rows with an edit still in the queue.
   *
   * The row keeps showing what the server has, because the queued payload is a set of form values
   * rather than a computed split: pretending otherwise would mean a total that disagreed with the
   * per-person amounts underneath it. So it says the change is waiting instead of faking it.
   */
  const pendingEdits = useMemo(
    () => new Set(pending.filter(isEdit).map((e) => e.expenseId)),
    [pending],
  );
  /*
   * Whether the feed has any rows to show, which is not the same as whether the group has history:
   * an expense with a delete waiting to be sent is already gone from the list. Deleting your last
   * one offline has to hide the floating button too, or it sits on top of the empty state's own
   * "add expense" and the screen offers the same action twice.
   */
  const ledgerHasRows =
    settlements.length > 0 || expenses.some((e) => !pendingDeletes.has(e.id));
  const [balanceShareStatus, setBalanceShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentBeforeRef = useRef<Balance[] | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<SettlementReceiptData | null>(null);

  async function load(): Promise<void> {
    setNotFound(false);
    setLoadFailed(false);
    try {
      const [g, b, e, st, s] = await Promise.all([
        groupsApi.get(id),
        groupsApi.balances(id),
        expensesApi.list(id),
        settlementsApi.list(id),
        settlementsApi.suggested(id),
      ]);
      setGroup(g);
      setBalances(b);
      setExpenses(e);
      setSettlements(st);
      setSuggested(s);
    } catch (err) {
      // Genuine "not yours / gone" only for 404/403; anything else is a transient failure.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setNotFound(true);
      } else {
        setLoadFailed(true);
      }
    }
  }

  async function refreshLedger(): Promise<{ balances: Balance[]; suggested: SuggestedPayment[] } | null> {
    // Refetch the group too, not just the ledger: if it was archived, renamed, or had a
    // member change in another tab/device, `group.archived` (which drives read-only) and the
    // member list must stay current, otherwise stale gates would keep edit controls live.
    // Callers fire this as `void refreshLedger()`, so a failed refetch would otherwise be a
    // swallowed rejection that leaves the just-succeeded change showing over stale data. Keep the
    // current view (it's still valid) but tell the user it may be behind.
    try {
      const [g, b, e, st, s] = await Promise.all([
        groupsApi.get(id),
        groupsApi.balances(id),
        expensesApi.list(id),
        settlementsApi.list(id),
        settlementsApi.suggested(id),
      ]);
      setGroup(g);
      setBalances(b);
      setExpenses(e);
      setSettlements(st);
      setSuggested(s);
      return { balances: b, suggested: s };
    } catch {
      toast.error('Could not load the latest changes. Reload if the numbers look off.');
      return null;
    }
  }

  /*
   * Put a saved expense on screen now, and let the ledger catch up behind it.
   *
   * The refetch pulls five endpoints, so waiting for it meant the row a person just typed appeared a
   * whole extra round trip after the save. Balances are deliberately NOT recomputed here: netting
   * paid against owed (per-item payers, tax and tip apportioned across shares) is the server's job,
   * and a second implementation of it on the client is a rounding difference waiting to happen. The
   * hero number counts up over 650ms anyway, so it landing a beat later reads as the animation.
   */
  function showSavedExpense(saved: Expense): void {
    setExpenses((current) => {
      const i = current.findIndex((e) => e.id === saved.id);
      if (i === -1) return [saved, ...current];
      const next = [...current];
      next[i] = saved;
      return next;
    });
  }

  /*
   * Tapping a slice is a question about the feed ("what was all that lodging?"), so it answers it
   * where the answer lives instead of filtering a list on the tab you can't see.
   */
  function filterByCategory(key: string | null): void {
    setCategoryFilter(key);
    // Picking a category is a request to go and look at it. Clearing one is not, so it leaves you
    // on the chart you cleared it from.
    if (key) setTab('activity');
  }

  /*
   * Sending what is waiting.
   *
   * Scoped to this group, because this is the screen with the ledger on it to refresh. The dashboard
   * runs the same hook unscoped, so a write queued here still goes out even if the next thing you
   * open is a different group.
   */
  useOutboxSync({
    groupId: id,
    onChanged: () => {
      play('add');
      void refreshLedger();
    },
    onQueueChanged: () => setPending(outboxQueued(id)),
  });

  /*
   * Photos on an expense that already exists.
   *
   * Not gated on the settle-up lock: a picture of a receipt does not move anybody's balance, so the
   * rule that stops the ledger changing after a payment has nothing to say about it. Archived groups
   * are read-only in the UI, which is why the sheet only gets these handlers when the group is live.
   */
  async function attachReceipt(expenseId: string, file: File): Promise<void> {
    try {
      await expensesApi.putReceipt(id, expenseId, file);
      setExpenses((current) =>
        current.map((e) => (e.id === expenseId ? { ...e, hasReceipt: true } : e)),
      );
      play('tick');
      toast.success('Photo attached.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that photo.');
    }
  }

  async function removeReceipt(expenseId: string): Promise<void> {
    try {
      await expensesApi.removeReceipt(id, expenseId);
      setExpenses((current) =>
        current.map((e) => (e.id === expenseId ? { ...e, hasReceipt: false } : e)),
      );
      toast.success('Photo removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that photo.');
    }
  }

  /** Resolves true when the payment reached the ledger, which is the panel's cue to reset the row. */
  async function markPaid(payment: SuggestedPayment, method: PaymentMethod): Promise<boolean> {
    const ok = await confirm({
      title: `Mark ${payment.fromName}'s payment as paid?`,
      body: 'This records the payment in owewell and updates everyone’s balances. It does not move money.',
      confirmLabel: 'Mark paid',
    });
    if (!ok) return false;
    setSettling(true);
    try {
      const beforeBalances = balances;
      const settlement = await settlementsApi.record(id, {
        fromUserId: payment.fromUserId,
        toUserId: payment.toUserId,
        amountCents: payment.amountCents,
        method,
      });
      const latest = await refreshLedger();
      if (latest) {
        setPaymentReceipt(buildSettlementReceipt(settlement, beforeBalances, latest.balances, latest.suggested));
      }
      // Clearing the last debt in the group is a different event from clearing one of five, and the
      // same fetch that redraws the list already knows which just happened.
      const allSettled = latest?.suggested.length === 0;
      play(allSettled ? 'allSettled' : 'settled');
      toast.success(
        allSettled
          ? 'Everyone is settled up.'
          : `Recorded a ${PAYMENT_METHOD_LABELS[method].toLowerCase()} payment from ${payment.fromName} to ${payment.toName}.`,
      );
      return true;
    } catch {
      toast.error('Could not record that payment.');
      return false;
    } finally {
      setSettling(false);
    }
  }

  async function saveBudget(budgetCents: number | null): Promise<void> {
    try {
      setGroup(await groupsApi.setBudget(id, budgetCents));
      toast.success(budgetCents === null ? 'Budget cleared.' : 'Budget shared with the group.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the budget.');
      throw error;
    }
  }

  async function saveSettlementDeadline(settleBy: string | null): Promise<void> {
    try {
      setGroup(await groupsApi.setSettlementDeadline(id, settleBy));
      toast.success(settleBy ? 'Settle-by deadline shared.' : 'Settle-by deadline cleared.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the deadline.');
      throw error;
    }
  }

  async function finishManualPayment(settlement: Settlement, beforeBalances: Balance[]): Promise<void> {
    setPaymentOpen(false);
    const latest = await refreshLedger();
    if (latest) {
      setPaymentReceipt(buildSettlementReceipt(settlement, beforeBalances, latest.balances, latest.suggested));
    }
    const allSettled = latest?.suggested.length === 0;
    play(allSettled ? 'allSettled' : 'settled');
    toast.success(allSettled ? 'Everyone is settled up.' : 'Payment logged.');
  }

  async function shareMyBalance(): Promise<void> {
    if (!group || myNet === 0 || balanceShareStatus) return;
    const amount = fmt(Math.abs(myNet));
    const text = myNet > 0
      ? `${group.name}: I’m owed ${amount}. Let’s get it settled in owewell.`
      : `${group.name}: I still owe ${amount}. I’ll send it over.`;
    const finish = (status: 'shared' | 'copied'): void => {
      setBalanceShareStatus(status);
      window.setTimeout(() => setBalanceShareStatus(null), 2200);
    };
    setBalanceShareStatus('sharing');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${group.name} balance`, text });
        finish('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setBalanceShareStatus(null);
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      finish('copied');
    } catch {
      setBalanceShareStatus(null);
      toast.error('Could not share your balance.');
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    groupsApi
      .list()
      .then((gs) => setAllGroups(gs.filter((g) => !g.archived)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  useGroupRealtime(id, () => {
    play('nudge');
    void refreshLedger();
  });

  /*
   * Delete, then offer it back. No modal.
   *
   * A confirm dialog asks you to predict a mistake you have not made yet, and everybody clicks
   * through it, so it costs a step every time and catches almost nothing. Undo costs a step only
   * when you were actually wrong. It is also what undoing a recorded payment already does two
   * sections up, and the two destructive actions in this app should not disagree about that.
   *
   * The restore is honest because deletion is a soft delete: the same row comes back with the same
   * id and the same splits, down to which person absorbed the odd cent.
   */
  async function deleteExpense(expenseId: string): Promise<void> {
    const removed = expenses.find((e) => e.id === expenseId);
    const name = removed ? `Deleted ${removed.description}.` : 'Expense deleted.';
    try {
      await expensesApi.remove(id, expenseId);
      // Off the list on the same tick as the toast, rather than one refetch later.
      setExpenses((current) => current.filter((e) => e.id !== expenseId));
      void refreshLedger();
      toast.success(name, { label: 'Undo', onClick: () => void undoDeleteExpense(expenseId) });
    } catch (err) {
      if (!isOffline(err)) {
        toast.error('Could not delete that expense.');
        return;
      }
      /*
       * Queued, and undone by dropping the queue entry.
       *
       * Calling restore here would be asking the server to put back something it never removed. The
       * row is hidden from the feed by the queued delete itself, so undo is simply forgetting it.
       */
      const clientId = crypto.randomUUID();
      enqueueWrite({
        clientId,
        groupId: id,
        kind: 'delete',
        expenseId,
        description: removed?.description ?? 'that expense',
        queuedAt: Date.now(),
      });
      setPending(outboxQueued(id));
      toast.success(`${name} It syncs when you have signal.`, {
        label: 'Undo',
        onClick: () => {
          dropWrite(clientId);
          setPending(outboxQueued(id));
        },
      });
    }
  }

  async function undoDeleteExpense(expenseId: string): Promise<void> {
    try {
      const restored = await expensesApi.restore(id, expenseId);
      showSavedExpense(restored);
      play('tick');
      void refreshLedger();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not put that back.');
    }
  }

  /*
   * Relabel, not convert.
   *
   * Stored amounts are integer minor units and stay exactly as they are, so a $40 dinner reads as
   * €40 afterwards. Converting would need a rate and a date for that rate, and would quietly rewrite
   * numbers people already agreed on. The toast says so rather than leaving it to be discovered.
   */
  async function changeCurrency(currency: string): Promise<void> {
    if (!group || currency === group.currency) return;
    try {
      const updated = await groupsApi.setCurrency(id, currency);
      setGroup(updated);
      setMenuOpen(false);
      toast.success(`Now counting in ${currency}. Amounts were relabelled, not converted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the currency.');
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!group) return;
    try {
      const updated = await groupsApi.setArchived(id, !group.archived);
      setGroup(updated);
      toast.success(updated.archived ? 'Group archived.' : 'Group restored.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the group. Try again.');
    }
  }

  async function undoSettlement(settlementId: string): Promise<void> {
    const ok = await confirm({
      title: 'Undo this payment?',
      body: 'It comes off the list and the balances go back to what they were.',
      confirmLabel: 'Undo',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await settlementsApi.remove(id, settlementId);
      await refreshLedger();
      play('undo');
      toast.success('Payment undone.');
    } catch {
      toast.error('Could not undo that payment.');
    }
  }

  async function saveRename(): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const updated = await groupsApi.rename(id, trimmed);
      setGroup(updated);
      setRenaming(false);
      toast.success('Group renamed.');
    } catch {
      toast.error('Could not rename the group.');
    }
  }

  async function deleteGroup(): Promise<void> {
    const ok = await confirm({
      title: 'Delete this whole group?',
      body: 'Every expense and balance goes with it. This cannot be undone.',
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await groupsApi.remove(id);
      navigate('/');
    } catch {
      toast.error('Could not delete the group.');
    }
  }

  /*
   * The four member writes.
   *
   * Each does its work, refetches, and says so on success — and lets the failure through rather than
   * swallowing it, because where the message belongs depends on which editor is still open. The
   * panel decides that. See `MembersPanel`.
   */
  async function removeFromGroup(targetUserId: string, netCents: number): Promise<void> {
    const reSplit =
      netCents !== 0
        ? "Their share of the expenses re-splits among everyone else (nothing gets marked as paid). "
        : '';
    const ok = await confirm({
      title: 'Remove this person?',
      body: `${reSplit}They lose access to this group. You can add them back later.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await groupsApi.removeMember(id, targetUserId);
      await load();
      toast.success('Removed them from the group.');
    } catch (err) {
      // The only one that toasts here: its confirm dialog has already closed, so there is no editor
      // left for the panel to put a message near.
      toast.error(err instanceof Error ? err.message : 'Could not remove them.');
    }
  }

  async function renameMember(memberId: string, name: string): Promise<void> {
    await groupsApi.renameMember(id, memberId, name);
    await load();
  }

  async function saveMemberHandles(memberId: string, handles: PaymentHandles): Promise<void> {
    await groupsApi.setPaymentHandles(id, memberId, handles);
    await load();
    toast.success('Payment handles saved.');
  }

  async function addMember(name: string): Promise<void> {
    await groupsApi.addPlaceholder(id, name);
    await load();
    toast.success('Added them to the group.');
  }

  /*
   * One formatter for this group's money: used directly by the page and handed to everything under it
   * through the provider at the bottom of the render.
   *
   * Declared up here with the other hooks rather than beside the derived values further down, because
   * the search memo below formats amounts to match them against the query. A `const` further down the
   * function body is in its temporal dead zone when that callback runs, so searching would have thrown.
   */
  const fmt = useMemo(() => currencyFormatter(group?.currency ?? DEFAULT_CURRENCY), [group?.currency]);

  /**
   * The invite link is a one-time action on a permanent surface, so it does not belong pinned to the
   * top forever: the balance does. But it is the obvious next step while a group has nobody in it yet,
   * or while people added by name still have not claimed their spot.
   *
   * So: promoted above the balances exactly while it is the answer, and back to the header button
   * afterwards. Same component either way.
   *
   * This has to live ABOVE the early returns below. It used to sit further down, next to the markup it
   * feeds, which meant the first render (group still null) bailed out before reaching this hook and the
   * render after it ran one hook more. That is React error #310, "rendered more hooks than during the
   * previous render", and it took out every group page the instant its data arrived. The `group?.` and
   * `!!group` guards here are what let it move up safely, and they were always the tell that this block
   * had been written as if it ran before the group existed.
   */
  const unclaimed = (group?.members ?? []).filter((m) => m.isPlaceholder).length;
  const needsPeople = !!group && !group.archived && ((group.members?.length ?? 0) === 1 || unclaimed > 0);

  // Fetch the token on its own when the group needs people, so the promoted block has something to
  // show without waiting for a tap. Deliberately gated on needsPeople: createShareLink is a write (it
  // mints the token if absent), and minting one for every group anyone ever opens would be wrong.
  useEffect(() => {
    if (!needsPeople || shareLink || !group) return;
    let alive = true;
    void groupsApi
      .createShareLink(group.id)
      .then((token) => {
        if (alive) setShareLink(`${window.location.origin}/s/${token}`);
      })
      .catch(() => undefined); // the header Invite button still works
    return () => {
      alive = false;
    };
  }, [needsPeople, shareLink, group]);

  if (loadFailed) {
    return (
      <Shell>
        <div className="rounded-3xl border border-dashed border-line p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
            <Icon name="wallet" size={22} />
          </div>
          <p className="mt-4 text-lg font-medium">Couldn&rsquo;t load this group.</p>
          <p className="mt-1 text-sm text-muted">Probably a hiccup on our end, not you.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-gradient mt-5 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <div className="rounded-3xl border border-dashed border-line p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
            <Icon name="users" size={22} />
          </div>
          <p className="mt-4 text-lg font-medium">That group went missing. Or was never yours.</p>
          <p className="mt-1 text-sm text-muted">
            It may have been deleted, or you&rsquo;re not a member.
          </p>
          <Link
            to="/"
            className="btn-gradient mt-5 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            <Icon name="arrow-left" size={15} /> Back to your groups
          </Link>
        </div>
      </Shell>
    );
  }

  if (!group) {
    return (
      <Shell>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-9 w-48" />
        <Skeleton className="mt-5 h-32 w-full rounded-3xl" />
        <Skeleton className="mt-8 h-4 w-20" />
        <div className="mt-3">
          <SkeletonList rows={3} />
        </div>
      </Shell>
    );
  }

  const nameOf = (userId: string): string =>
    group.members.find((m) => m.userId === userId)?.displayName ?? 'Someone';
  const detailExpense = expenses.find((e) => e.id === detailExpenseId) ?? null;
  const balanceByUser = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === 'OWNER';
  const myNet = balanceByUser[user?.id ?? ''] ?? 0;
  const settled = myNet === 0;
  const owed = myNet > 0;
  // You can be square (net 0) while the group still has debts between others.
  // Only call it "all settled" when there are no outstanding transfers at all.
  const groupSettled = suggested.length === 0;
  // The whole group's outstanding money, not just yours: the sum of every positive balance
  // (which equals the total the debtors owe, since balances net to zero). Shown as context so
  // "You're square" doesn't read as "the group is done" when others still owe each other.
  const totalUnsettled = balances.reduce((sum, b) => sum + Math.max(0, b.netCents), 0);
  // Total money spent on bills in this group (settlements aren't spending, so expenses only).
  const monthlyPulse = spendingPulse(expenses);
  // How much has already been paid back, and the even-split average across the members.
  const totalSettled = settlements.reduce((sum, s) => sum + s.amountCents, 0);
  // Payments and the outstanding balance describe one journey toward zero. Clamp at 100 because
  // manual payments can intentionally overpay an earlier split, and a progress bar past the end
  // would make an otherwise valid ledger look broken.
  const settlementJourney = totalSettled + totalUnsettled;
  const settlementProgress = settlementJourney > 0 ? Math.min(100, Math.round((totalSettled / settlementJourney) * 100)) : 0;
  // A brand-new group has no expenses or payments yet — show a "nothing yet" hero, not "settled".
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  const groupRecap = groupSettled && expenses.length > 0
    ? buildGroupRecap(expenses, settlements)
    : null;


  async function onShare(): Promise<void> {
    if (!group) return;
    let url: string;
    try {
      const token = await groupsApi.createShareLink(group.id);
      url = `${window.location.origin}/s/${token}`;
    } catch {
      toast.error('Could not create a share link.');
      return;
    }
    // Always reveal the link on screen so it's visible no matter what the browser supports.
    setShareLink(url);
    // On phones, offer the native share sheet (a dismissed sheet is not an error). Desktop just
    // uses the visible link + Copy button below. Pass only title + url, never a text body: this is
    // an invite, so the sheet's "Copy" must copy the link itself — a text body makes iOS copy that
    // instead of the link.
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join "${group.name}" on owewell`, url });
      } catch {
        /* dismissed — the link stays visible below */
      }
    }
  }

  function exportActivity(): void {
    if (!group) return;
    // An export is intentionally ledger-shaped rather than an attempt to recreate the whole UI in
    // a spreadsheet. Expenses and payments share one sorted timeline, with names resolved at the
    // time of export so it remains readable after somebody changes their display name elsewhere.
    const rows = [
      ...expenses.map((expense) => ({
        date: expense.date || expense.createdAt,
        type: 'Expense',
        description: expense.description,
        amount: fmt(expense.amountCents),
        details: `${nameOf(expense.payerId)} paid · ${categoryMeta(expense.category).label}`,
      })),
      ...settlements.map((settlement) => ({
        date: settlement.createdAt,
        type: 'Payment',
        description: `${nameOf(settlement.fromUserId)} → ${nameOf(settlement.toUserId)}`,
        amount: fmt(settlement.amountCents),
        details: settlement.method ? `via ${PAYMENT_METHOD_LABELS[settlement.method]}` : 'payment recorded',
      })),
      ...balances.map((balance) => ({
        date: '',
        type: 'Current balance',
        description: nameOf(balance.userId),
        amount: fmt(Math.abs(balance.netCents)),
        details: balance.netCents > 0 ? 'is owed' : balance.netCents < 0 ? 'owes' : 'settled up',
      })),
    ].sort((a, b) => {
      if (a.type === 'Current balance') return b.type === 'Current balance' ? a.description.localeCompare(b.description) : 1;
      if (b.type === 'Current balance') return -1;
      return a.date.localeCompare(b.date);
    });
    const csv = [
      ['Date', 'Type', 'Description', 'Amount', 'Details'],
      ...rows.map((row) => [
        new Date(row.date).toLocaleDateString(), row.type, row.description, row.amount, row.details,
      ]),
    ].map((row) => row.map(csvCell).join(',')).join('\r\n');
    // BOM keeps names and descriptions with emoji/non-Latin characters intact in desktop Excel.
    const href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `${group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'owewell'}-activity.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    toast.success('Activity exported as a CSV.');
    setMenuOpen(false);
  }

  async function copyShareLink(): Promise<void> {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  }

  return (
    <CurrencyProvider code={group.currency}>
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-ink"
        >
          <Icon name="arrow-left" size={16} /> Your groups
        </Link>
        {allGroups.length > 1 && allGroups.some((g) => g.id === id) && (
          <select
            value={id}
            onChange={(e) => {
              if (e.target.value !== id) navigate(`/groups/${e.target.value}`);
            }}
            aria-label="Switch group"
            className="max-w-[55%] truncate rounded-full border border-line bg-field px-3 py-1.5 text-sm text-muted outline-none transition hover:text-ink focus:border-accent"
          >
            {allGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {renaming ? (
        <div className="mt-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Group name"
            className="flex-1 rounded-xl border border-line bg-field px-3 py-2 font-display text-2xl outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void saveRename()}
            className="btn-gradient rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            <span className="truncate">{group.name}</span>
            {group.archived && (
              <span className="shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-xs font-medium text-muted">
                archived
              </span>
            )}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void onShare()}
              aria-label="Invite people to this group"
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-surface2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent sm:w-auto sm:px-3.5"
            >
              {/* Icon-only on phones, where the header competes with a long group name for width. The
                  aria-label above carries the meaning either way, so nothing is lost to a screen
                  reader. */}
              <Icon name="share" size={15} />
              <span className="hidden sm:inline">Invite</span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Group options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
              >
                <Icon name="more" size={18} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="surface absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-2xl border border-line py-1 shadow-xl shadow-black/40"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={exportActivity}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                  >
                    <Icon name="receipt" size={15} /> Export activity
                  </button>
                  {isOwner && (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setNewName(group.name);
                        setRenaming(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                    >
                      <Icon name="pencil" size={15} /> Rename
                    </button>
                  )}
                  {isOwner && (
                    <label className="flex w-full items-center justify-between gap-2.5 px-4 py-2.5 text-left text-sm">
                      <span className="flex items-center gap-2.5">
                        <Icon name="wallet" size={15} /> Currency
                      </span>
                      <select
                        value={group.currency}
                        onChange={(e) => void changeCurrency(e.target.value)}
                        aria-label="Group currency"
                        className="rounded-lg border border-line bg-field px-2 py-1 text-sm outline-none focus:border-accent"
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* Per-member: archiving hides the group from your own list only. */}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => void toggleArchive()}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-surface2"
                  >
                    <Icon name={group.archived ? 'undo' : 'archive'} size={15} />{' '}
                    {group.archived ? 'Unarchive (show in my list)' : 'Archive (hide from my list)'}
                  </button>
                  {isOwner && (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => void deleteGroup()}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neg transition hover:bg-surface2"
                    >
                      <Icon name="trash" size={15} /> Delete group
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/*
        * Left-aligned while there is a number, centred once there isn't.
        *
        * A left edge is a column for figures to line up on, and "You're square" is not a figure. Set
        * in the same place at the same size it read as a sentence abandoned in the corner, so the
        * ending gets its own composition: the mark, then the words, centred under it.
        */}
      <div className={`glass mt-5 rounded-3xl p-6 sm:p-7 ${settled ? 'text-center' : ''}`}>
        {/* A group with nothing on it is not "settled", it just hasn't started. No mark for that. */}
        {hasActivity && settled && <SettledMark tone={groupSettled ? 'settled' : 'square'} />}
        <p className={`text-sm font-medium text-muted ${hasActivity && settled ? 'mt-4' : ''}`}>
          {!hasActivity
            ? group.members.length < 2
              ? 'First, add the people'
              : 'Nothing on the tab yet'
            : settled
              ? groupSettled
                ? 'Everyone is clear'
                : 'Your standing here'
              : owed
                ? "You're owed"
                : 'You owe'}
        </p>
        <p
          className={`mt-1 font-display font-extrabold tracking-tight ${
            settled ? 'text-3xl sm:text-4xl' : 'text-5xl sm:text-6xl'
          } ${settled ? (hasActivity && groupSettled ? 'text-pos' : 'text-ink') : owed ? 'text-gradient' : 'text-neg'}`}
        >
          {!hasActivity ? (
            group.members.length < 2 ? (
              'Just you so far'
            ) : (
              'Nothing yet'
            )
          ) : settled ? (
            groupSettled ? (
              'All settled'
            ) : (
              "You're square"
            )
          ) : (
            <MoneyText cents={Math.abs(myNet)} />
          )}
        </p>
        {totalUnsettled > 0 && (
          <p className="mt-2 text-xs text-faint">
            {fmt(totalUnsettled)} still unsettled across the group
          </p>
        )}
        {totalSettled > 0 && (
          <p className="mt-1 text-xs text-faint">
            {fmt(totalSettled)} settled so far
          </p>
        )}
        {monthlyPulse && (
          <div className={`mt-4 flex max-w-sm items-center justify-between gap-4 rounded-xl border border-line bg-surface/60 px-3.5 py-2.5 text-left text-sm ${settled ? 'mx-auto' : ''}`}>
            <span>
              <span className="block text-xs text-faint">This month</span>
              <span className="tnum font-semibold text-ink">{fmt(monthlyPulse.currentCents)}</span>
            </span>
            <span className={`text-right text-xs font-medium ${monthlyPulse.change === 'up' ? 'text-neg' : monthlyPulse.change === 'down' ? 'text-pos' : 'text-muted'}`}>
              {pulseLabel(monthlyPulse)}
            </span>
          </div>
        )}
        {settlementJourney > 0 && (
          <div className={`mt-4 max-w-xs ${settled ? 'mx-auto' : ''}`}>
            <div className="mb-1.5 flex items-center justify-between text-xs text-faint">
              <span>settle-up progress</span>
              <span className="font-medium text-muted">{settlementProgress}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Settle-up progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={settlementProgress}
              aria-valuetext={`${settlementProgress}% of recorded settle-up payments complete`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-pos transition-[width] duration-500"
                style={{ width: `${settlementProgress}%` }}
              />
            </div>
          </div>
        )}
        {hasActivity && groupSettled && (
          <div className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${settled ? 'justify-center' : ''}`}>
            <span>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} · {settlements.length} {settlements.length === 1 ? 'payment' : 'payments'} recorded</span>
          </div>
        )}
        {/* One row, so the two links can't sit flush against each other when both are showing. */}
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${settled ? 'justify-center' : ''}`}>
        {hasActivity && !settled && (
          <button
            type="button"
            onClick={() => void shareMyBalance()}
            disabled={balanceShareStatus !== null}
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
          >
            <Icon name="share" size={13} />
            {balanceShareStatus === 'sharing' ? 'Opening…' : balanceShareStatus === 'shared' ? 'Balance shared' : balanceShareStatus === 'copied' ? 'Balance copied' : 'Send my balance'}
          </button>
        )}
        {/* The end of a tab should hand you somewhere to go, and the wrapped card is the reward. */}
        {groupRecap && (
          <button
            type="button"
            onClick={() => setTab('summary')}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-pos transition hover:underline"
          >
            <Icon name="sparkles" size={15} /> See the tab, wrapped
          </button>
        )}
        {!hasActivity ? (
          <p className="mt-4 text-sm text-muted">Add an expense to get the tab going.</p>
        ) : group.members.length < 2 ? (
          <p className="mt-4 text-sm text-muted">Add someone else before you can log a payment.</p>
        ) : !groupSettled ? (
          <button
            type="button"
            onClick={() => {
              paymentBeforeRef.current = balances;
              setPaymentOpen(true);
            }}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink hover:underline"
          >
            <Icon name="wallet" size={15} /> Log a payment
          </button>
        ) : null}
        </div>
      </div>

      {/* Two questions, two tabs. The balance above stays put; only the answer underneath swaps. */}
      <div className="mt-5 inline-flex w-full rounded-full border border-line bg-field p-1" role="tablist" aria-label="Group view">
        {(['activity', 'summary'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={tab === view}
            onClick={() => setTab(view)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
              tab === view ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {view}
          </button>
        ))}
      </div>

      {tab === 'activity' && (
        <>
        {paymentReceipt && (
          <SettlementReceipt receipt={paymentReceipt} onClose={() => setPaymentReceipt(null)} />
        )}

        {/* Promoted while the group still needs people: this is the obvious next thing to do, so it should
            not require finding the Invite button first. */}
        {needsPeople && shareLink && (
          <InviteLink
            link={shareLink}
            copied={copied}
            onCopy={() => void copyShareLink()}
            headline={
              unclaimed > 0
                ? `Send this to ${unclaimed === 1 ? 'them' : 'them all'} so they can claim their spot`
                : "Send this to the people you're splitting with"
            }
            hint={
              unclaimed > 0
                ? `${unclaimed === 1 ? 'One person is' : `${unclaimed} people are`} in here by name only. This link lets them sign in and take over their own spot.`
                : "It's just you in here so far. Anyone with the link can see the group and claim their spot."
            }
          />
        )}

        {/* And tucked back down here once they are in. */}
        {shareLink && !needsPeople && (
          <InviteLink link={shareLink} copied={copied} onCopy={() => void copyShareLink()} />
        )}

        {suggested.length > 0 && (
          <SettleUpPanel
            group={group}
            suggested={suggested}
            balances={balances}
            isOwner={isOwner}
            settling={settling}
            onMarkPaid={markPaid}
            onSaveDeadline={saveSettlementDeadline}
          />
        )}

        <ActivityFeed
          expenses={expenses}
          settlements={settlements}
          members={group.members}
          currentUserId={user?.id}
          pendingRows={pendingRows}
          pendingDeletes={pendingDeletes}
          pendingEdits={pendingEdits}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          onOpenExpense={setDetailExpenseId}
          onUndoSettlement={undoSettlement}
          onAddExpense={() => setSheetOpen(true)}
        />
        </>
      )}

      {tab === 'summary' && (
        <>
        <SummaryTab
          groupName={group.name}
          recap={groupRecap}
          expenses={expenses}
          settlements={settlements}
          balances={balances}
          members={group.members}
          budgetCents={group.budgetCents}
          isOwner={isOwner}
          categoryFilter={categoryFilter}
          onSelectCategory={filterByCategory}
          onSaveBudget={saveBudget}
        />


        <MembersPanel
          key={group.id}
          members={group.members}
          balances={balances}
          currentUserId={user?.id}
          isOwner={isOwner}
          hasActivity={hasActivity}
          paymentsRecorded={settlements.length > 0}
          onRename={renameMember}
          onSaveHandles={saveMemberHandles}
          onAdd={addMember}
          onRemove={removeFromGroup}
        />
        </>
      )}

      {/* The floating add button appears only once there's a list to add to; the empty state owns
          the first-expense CTA, so a brand-new group doesn't show two "add expense" buttons. */}
      {ledgerHasRows && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Add expense"
          className="btn-gradient fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex items-center gap-2 rounded-full p-4 font-semibold shadow-xl shadow-black/30 transition active:scale-[0.97] sm:px-6 sm:py-3.5"
        >
          <Icon name="plus" size={20} /> <span className="hidden sm:inline">Add expense</span>
        </button>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add to the tab">
        <div className="mb-2.5 inline-flex w-full rounded-full border border-line bg-field p-1">
          <button
            type="button"
            onClick={() => setExpenseMode('simple')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              expenseMode === 'simple' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            Split a total
          </button>
          <button
            type="button"
            onClick={() => setExpenseMode('itemized')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              expenseMode === 'itemized' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            Itemize a receipt
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          {expenseMode === 'simple'
            ? 'One amount for the whole group. Split evenly, or by custom amounts, shares, or percent.'
            : 'People ordered different things? Add each line item plus tax and tip, and we work out what everyone owes.'}
        </p>
        {expenseMode === 'simple' ? (
          <AddExpenseForm
            key={`simple-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={(saved) => {
              setSheetOpen(false);
              play('add');
              toast.success('Added to the tab.');
              showSavedExpense(saved);
              void refreshLedger();
            }}
            onQueued={(description) => {
              setSheetOpen(false);
              setPending(outboxQueued(id));
              toast.success(`Kept "${description}". It goes out when you have signal.`);
            }}
            onPhotoFailed={(message) => toast.error(`Saved, but the photo didn't: ${message}`)}
          />
        ) : (
          <AddItemizedExpenseForm
            key={`itemized-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={(saved) => {
              setSheetOpen(false);
              play('add');
              toast.success('Receipt added to the tab.');
              showSavedExpense(saved);
              void refreshLedger();
            }}
            onQueued={(description) => {
              setSheetOpen(false);
              setPending(outboxQueued(id));
              toast.success(`Kept "${description}". It goes out when you have signal.`);
            }}
            onPhotoFailed={(message) => toast.error(`Saved, but the photo didn't: ${message}`)}
          />
        )}
      </Sheet>

      <Sheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Log a payment">
        <RecordPaymentForm
          groupId={group.id}
          members={group.members}
          balances={balances}
          defaultFromId={user?.id}
          suggestions={suggested}
          onQueued={(summary) => {
            setPaymentOpen(false);
            setPending(outboxQueued(id));
            toast.success(`Kept the payment ${summary}. It goes out when you have signal.`);
          }}
          onRecorded={(settlement) => {
            const beforeBalances = paymentBeforeRef.current ?? balances;
            paymentBeforeRef.current = null;
            void finishManualPayment(settlement, beforeBalances);
          }}
        />
      </Sheet>

      <Sheet
        open={!!detailExpense}
        onClose={() => setDetailExpenseId(null)}
        title={detailExpense?.description ?? 'Expense'}
      >
        {detailExpense && (
          <ExpenseDetail
            expense={detailExpense}
            receiptSrc={receiptUrl(id, detailExpense.id)}
            members={group.members}
            viewerId={user?.id}
            locked={settlements.length > 0}
            archived={group.archived}
            onEdit={() => {
              setDetailExpenseId(null);
              setEditingExpense(detailExpense);
            }}
            onDuplicate={() => {
              setDetailExpenseId(null);
              setDuplicatingExpense(detailExpense);
            }}
            {...(group.archived
              ? {}
              : {
                  onAttachReceipt: (file: File) => void attachReceipt(detailExpense.id, file),
                  onRemoveReceipt: () => void removeReceipt(detailExpense.id),
                })}
            onDelete={() => {
              // The sheet stays open behind the confirm and closes on its own when the expense
              // leaves the list, so a cancelled delete puts you back where you were.
              void deleteExpense(detailExpense.id);
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={!!editingExpense}
        onClose={() => setEditingExpense(null)}
        title={editingExpense?.splitMethod === 'ITEMIZED' ? 'Edit receipt' : 'Edit expense'}
      >
        {editingExpense &&
          (editingExpense.splitMethod === 'ITEMIZED' ? (
            <AddItemizedExpenseForm
              key={`edit-${editingExpense.id}`}
              groupId={group.id}
              members={group.members}
              editing={editingExpense}
              onCreated={(saved) => {
                setEditingExpense(null);
                play('tick');
                toast.success('Receipt updated.');
                showSavedExpense(saved);
                void refreshLedger();
              }}
              onQueued={(description) => {
                setEditingExpense(null);
                setPending(outboxQueued(id));
                toast.success(`Your change to "${description}" goes out when you have signal.`);
              }}
            />
          ) : (
            <AddExpenseForm
              key={`edit-${editingExpense.id}`}
              groupId={group.id}
              members={group.members}
              editing={editingExpense}
              onCreated={(saved) => {
                setEditingExpense(null);
                play('tick');
                toast.success('Expense updated.');
                showSavedExpense(saved);
                void refreshLedger();
              }}
              onQueued={(description) => {
                setEditingExpense(null);
                setPending(outboxQueued(id));
                toast.success(`Your change to "${description}" goes out when you have signal.`);
              }}
            />
          ))}
      </Sheet>

      <Sheet
        open={!!duplicatingExpense}
        onClose={() => setDuplicatingExpense(null)}
        title={duplicatingExpense?.splitMethod === 'ITEMIZED' ? 'Duplicate this receipt' : 'Duplicate this expense'}
      >
        {duplicatingExpense && (
          <>
            <p className="mb-4 text-sm text-muted">
              Everything is copied over with today&rsquo;s date. Change anything that was different this time.
            </p>
            {duplicatingExpense.splitMethod === 'ITEMIZED' ? (
              <AddItemizedExpenseForm
                key={`duplicate-${duplicatingExpense.id}`}
                groupId={group.id}
                members={group.members}
                template={duplicatingExpense}
                onCreated={(saved) => {
                  setDuplicatingExpense(null);
                  play('add');
                  toast.success('Added the receipt again.');
                  showSavedExpense(saved);
                  void refreshLedger();
                }}
              />
            ) : (
              <AddExpenseForm
                key={`duplicate-${duplicatingExpense.id}`}
                groupId={group.id}
                members={group.members}
                template={duplicatingExpense}
                onCreated={(saved) => {
                  setDuplicatingExpense(null);
                  play('add');
                  toast.success('Added it again.');
                  showSavedExpense(saved);
                  void refreshLedger();
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </Shell>
    </CurrencyProvider>
  );
}
