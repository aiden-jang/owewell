import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  correctionLine,
  CURRENCIES,
  currencyFormatter,
  DEFAULT_CURRENCY,
  type CorrectionField,
  type MoneyFormatter,
} from '@owewell/shared';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  categoryMeta,
  type CreateExpensePayload,
  type CreateItemizedPayload,
  type PaymentMethod,
} from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { InviteLink } from '../components/InviteLink';
import { MoneyText } from '../components/MoneyText';
import { SpendDonut } from '../components/SpendDonut';
import {
  matchesPersonLens,
  spendByCategory as computeSpendByCategory,
  lensTotal as computeLensTotal,
} from '../lib/activityFilters';
import { Sheet } from '../components/Sheet';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { RecordPaymentForm } from '../components/RecordPaymentForm';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { groupsApi, type Balance, type GroupDetail, type GroupMember, type GroupSummary } from '../lib/groups';
import { expensesApi, receiptUrl, type Expense } from '../lib/expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { payLinks } from '../lib/payLinks';
import { ApiError } from '../lib/api';
import { useGroupRealtime } from '../hooks/useGroupRealtime';
import { play } from '../lib/sound';
import { ExpenseDetail } from '../components/ExpenseDetail';
import { CurrencyProvider } from '../lib/currency';
import {
  flush as flushOutboxWrites,
  queued as outboxQueued,
  subscribe as outboxSubscribe,
  type QueuedWrite,
} from '../lib/outbox';
import { pulseLabel, spendingPulse } from '../lib/spendingPulse';
import { buildSettlementReceipt, type SettlementReceiptData } from '../lib/settlementReceipt';
import { SettlementReceipt } from '../components/SettlementReceipt';
import { SettledMark } from '../components/SettledMark';
import { SettlementDeadline } from '../components/SettlementDeadline';
import { TripBudget } from '../components/TripBudget';
import { tripBudget } from '../lib/tripBudget';
import { FrontingInsight } from '../components/FrontingInsight';
import { bestSettlementStep, projectBalancesAfterPayment } from '../lib/settlementGuide';
import { paymentNudgeText, type NudgeTone } from '../lib/paymentNudge';
import { buildGroupRecap } from '../lib/groupRecap';
import { timeAgoShort as timeAgo } from '../lib/relativeTime';
import { renderSettleCard } from '../lib/settleCard';

/** How much of the feed renders before asking. Deep enough that most groups never see the button. */
const ACTIVITY_PAGE = 50;

function balanceLabel(netCents: number, hasActivity: boolean, fmt: MoneyFormatter): { text: string; tone: string } {
  // No expenses yet means nobody is settled OR unsettled — there's just nothing owed. Don't label
  // a brand-new member "settled up"; that only makes sense once there's been something to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

function balanceStateLabel(netCents: number, fmt: MoneyFormatter): string {
  if (netCents === 0) return 'square';
  const amount = fmt(Math.abs(netCents));
  return netCents > 0 ? `is owed ${amount}` : `owes ${amount}`;
}

function csvCell(value: string | number): string {
  // Spreadsheet apps execute leading formula characters even inside imported CSV files. User
  // controlled descriptions and names must stay text when the export is opened in Excel/Sheets.
  const raw = String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type Activity =
  | { kind: 'expense'; ts: number; expense: Expense }
  | { kind: 'settlement'; ts: number; settlement: Settlement };

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
  const [memberName, setMemberName] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [expenseMode, setExpenseMode] = useState<'simple' | 'itemized'>('simple');
  const [sheetOpen, setSheetOpen] = useState(false);
  // All the viewer's groups, for the header switcher. Fetched once; the list rarely changes.
  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // A "person lens" over both the breakdown and the feed: pick a person, then how they relate to
  // an expense — involved (paid or owe a share) / owes (a share they didn't pay) / paid. Null
  // person = no lens. Category is a separate drill-down from the chart into the feed only.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<'involved' | 'owes' | 'paid'>('involved');
  const [activityQuery, setActivityQuery] = useState('');
  // "Where it went" can render as bars (default, easiest to compare) or a part-to-whole donut.
  const [breakdownView, setBreakdownView] = useState<'bars' | 'donut'>('bars');
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
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [payingMemberId, setPayingMemberId] = useState<string | null>(null);
  const [payVenmo, setPayVenmo] = useState('');
  const [payCashapp, setPayCashapp] = useState('');
  const [payPaypal, setPayPaypal] = useState('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [duplicatingExpense, setDuplicatingExpense] = useState<Expense | null>(null);
  // Held by id, not by value: an edit or a realtime refetch replaces the object in `expenses`, and the
  // open sheet has to follow it. A deleted expense drops out of the list, which closes the sheet.
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [pending, setPending] = useState<QueuedWrite[]>(() => outboxQueued(id));
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('cash');
  const [settleShareStatus, setSettleShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
  const [settleCardStatus, setSettleCardStatus] = useState<'making' | 'shared' | 'saved' | null>(null);
  const [recapShareStatus, setRecapShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
  const [balanceShareStatus, setBalanceShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentBeforeRef = useRef<Balance[] | null>(null);
  const [paymentInFlight, setPaymentInFlight] = useState<string | null>(null);
  const [paymentPreview, setPaymentPreview] = useState<string | null>(null);
  const [paymentNudge, setPaymentNudge] = useState<string | null>(null);
  const [nudgeTone, setNudgeTone] = useState<NudgeTone>('gentle');
  const [nudgeShareStatus, setNudgeShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
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
  function filterByCategory(key: string): void {
    setCategoryFilter(key);
    setTab('activity');
  }

  /*
   * Send whatever is waiting, then say what happened to it.
   *
   * Called on mount, whenever the browser says it is back online, and after any successful write
   * (a write getting through is the most reliable evidence there is that the network is back —
   * `navigator.onLine` only means "attached to a network", which a captive portal also satisfies).
   */
  const flushing = useRef(false);
  const flushOutbox = useCallback(async (): Promise<void> => {
    /*
     * One flush at a time.
     *
     * A flaky connection fires `online` more than once, and mount plus a reconnect can overlap, so
     * two passes would take the same entry off the queue twice and post it twice. The server's
     * clientId check means that is not a duplicate expense — which is the whole reason it exists —
     * but a wasted round trip and two identical toasts are still wrong.
     */
    if (flushing.current) return;
    flushing.current = true;
    try {
      await runFlush();
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runFlush = async (): Promise<void> => {
    const { sent, rejected } = await flushOutboxWrites(
      (entry) =>
        entry.kind === 'itemized'
          ? expensesApi.createItemized(entry.groupId, entry.payload as CreateItemizedPayload)
          : expensesApi.create(entry.groupId, entry.payload as CreateExpensePayload),
      id,
    );
    setPending(outboxQueued(id));
    if (sent > 0) {
      play('add');
      toast.success(sent === 1 ? 'Sent the expense that was waiting.' : `Sent ${sent} waiting expenses.`);
      void refreshLedger();
    }
    for (const { entry, message } of rejected) {
      // Named, because it is gone from the queue and the person has to know which one to retype.
      toast.error(`"${entry.description}" could not be saved: ${message}`);
    }
  };

  useEffect(() => {
    setPending(outboxQueued(id));
    void flushOutbox();
    const onOnline = (): void => void flushOutbox();
    window.addEventListener('online', onOnline);
    const unsubscribe = outboxSubscribe(() => setPending(outboxQueued(id)));
    return () => {
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
  }, [id, flushOutbox]);

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

  async function markPaid(payment: SuggestedPayment): Promise<void> {
    const ok = await confirm({
      title: `Mark ${payment.fromName}'s payment as paid?`,
      body: 'This records the payment in owewell and updates everyone’s balances. It does not move money.',
      confirmLabel: 'Mark paid',
    });
    if (!ok) return;
    setSettling(true);
    try {
      const beforeBalances = balances;
      const settlement = await settlementsApi.record(id, {
        fromUserId: payment.fromUserId,
        toUserId: payment.toUserId,
        amountCents: payment.amountCents,
        method: settleMethod,
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
                    : `Recorded a ${PAYMENT_METHOD_LABELS[settleMethod].toLowerCase()} payment from ${payment.fromName} to ${payment.toName}.`,
      );
      setPaymentInFlight(null);
    } catch {
      toast.error('Could not record that payment.');
    } finally {
      setSettling(false);
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

  async function shareSettlePlan(): Promise<void> {
    if (!group || suggested.length === 0) return;
    const lines = suggested.map(
      (payment) => `• ${payment.fromName} pays ${payment.toName} ${fmt(payment.amountCents)}`,
    );
    const total = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
    const transferLabel = suggested.length === 1 ? 'transfer' : 'transfers';
    const deadline = group.settleBy
      ? `\nSettle by ${new Date(group.settleBy).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : '';
    const text = `${group.name} settle-up\n${fmt(total)} across ${suggested.length} ${transferLabel}${deadline}\n\n${lines.join('\n')}`;
    const finish = (status: 'shared' | 'copied'): void => {
      setSettleShareStatus(status);
      window.setTimeout(() => setSettleShareStatus(null), 2200);
    };
    setSettleShareStatus('sharing');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${group.name} settle-up`, text });
        finish('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setSettleShareStatus(null);
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      finish('copied');
    } catch {
      setSettleShareStatus(null);
      toast.error('Could not share the settle-up plan.');
    }
  }

  async function shareSettleCard(): Promise<void> {
    if (!group || suggested.length === 0 || settleCardStatus) return;
    setSettleCardStatus('making');
    try {
      const blob = await renderSettleCard(group.name, suggested, fmt);
      if (!blob) {
        setSettleCardStatus(null);
        toast.error('Could not make the settle-up card.');
        return;
      }
      const slug = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
      const file = new File([blob], `${slug}-settle-up.png`, { type: 'image/png' });
      const canShare = typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
      if (canShare) {
        try {
          await navigator.share({ title: `${group.name} settle-up`, files: [file] });
          setSettleCardStatus('shared');
          window.setTimeout(() => setSettleCardStatus(null), 2200);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setSettleCardStatus(null);
            return;
          }
        }
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setSettleCardStatus('saved');
      window.setTimeout(() => setSettleCardStatus(null), 2200);
    } catch {
      setSettleCardStatus(null);
      toast.error('Could not make the settle-up card.');
    }
  }

  async function sharePaymentNudge(payment: SuggestedPayment): Promise<void> {
    if (!group || nudgeShareStatus) return;
    const recipient = group.members.find(member => member.userId === payment.toUserId) ?? {
      venmoHandle: null,
      cashappCashtag: null,
      paypalHandle: null,
    };
    const payUrl = payLinks(recipient, payment.amountCents, `owewell: ${group.name}`)[0]?.url;
    const text = paymentNudgeText(
      {
        fromName: payment.fromName,
        toName: payment.toName,
        amountCents: payment.amountCents,
        groupName: group.name,
        payUrl,
      },
      nudgeTone,
      fmt,
    );
    const finish = (status: 'shared' | 'copied'): void => {
      setNudgeShareStatus(status);
      window.setTimeout(() => setNudgeShareStatus(null), 2200);
    };
    setNudgeShareStatus('sharing');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${group.name} payment reminder`, text });
        finish('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setNudgeShareStatus(null);
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      finish('copied');
    } catch {
      setNudgeShareStatus(null);
      toast.error('Could not share that reminder.');
    }
  }

  // The final payment is a natural handoff point: someone usually wants to tell the group that
  // nothing is hanging over them anymore. Keep the recap factual and compact so it is useful in a
  // group chat without exposing the individual balance history again.
  async function shareSettledRecap(): Promise<void> {
    if (!group || recapShareStatus) return;
    const recap = buildGroupRecap(expenses, settlements);
    const paymentLabel = settlements.length === 1 ? 'payment' : 'payments';
    const highlights = [
      recap.topCategory ? `Top category: ${recap.topCategory.emoji} ${recap.topCategory.label} (${fmt(recap.topCategory.amountCents)})` : null,
      recap.largest ? `Biggest expense: ${recap.largest.description} (${fmt(recap.largest.amountCents)})` : null,
      recap.daysOpen ? `Tab open for ${recap.daysOpen} ${recap.daysOpen === 1 ? 'day' : 'days'}` : null,
    ].filter(Boolean).join('\n');
    const text = `${group.name} is all settled ✓\n${fmt(recap.totalCents)} split across ${group.members.length} people\n${settlements.length} ${paymentLabel} recorded${highlights ? `\n\n${highlights}` : ''}`;
    const finish = (status: 'shared' | 'copied'): void => {
      setRecapShareStatus(status);
      window.setTimeout(() => setRecapShareStatus(null), 2200);
    };
    setRecapShareStatus('sharing');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${group.name} is settled`, text });
        finish('shared');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setRecapShareStatus(null);
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      finish('copied');
    } catch {
      setRecapShareStatus(null);
      toast.error('Could not share the settled recap.');
    }
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

  // A one-person group's only next step is adding people, but that lives in the collapsed Members
  // section. Auto-expand it on load when the group still needs someone, so the primary action
  // isn't buried. Keyed on the group id so it fires on load/switch, not on every refresh, and
  // doesn't fight a manual toggle afterward.
  useEffect(() => {
    if (group) setMembersOpen(group.members.length < 2);
  }, [group?.id]);

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
    try {
      await expensesApi.remove(id, expenseId);
      // Off the list on the same tick as the toast, rather than one refetch later.
      setExpenses((current) => current.filter((e) => e.id !== expenseId));
      void refreshLedger();
      toast.success(removed ? `Deleted ${removed.description}.` : 'Expense deleted.', {
        label: 'Undo',
        onClick: () => void undoDeleteExpense(expenseId),
      });
    } catch {
      toast.error('Could not delete that expense.');
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
      toast.error(err instanceof Error ? err.message : 'Could not remove them.');
    }
  }

  async function saveMemberName(memberId: string): Promise<void> {
    const name = editingMemberName.trim();
    if (!name) return;
    try {
      await groupsApi.renameMember(id, memberId, name);
      setEditingMemberId(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rename them.');
    }
  }

  function startEditPayment(m: GroupMember): void {
    setPayingMemberId(m.userId);
    setPayVenmo(m.venmoHandle ?? '');
    setPayCashapp(m.cashappCashtag ?? '');
    setPayPaypal(m.paypalHandle ?? '');
  }

  async function savePaymentHandles(memberId: string): Promise<void> {
    try {
      await groupsApi.setPaymentHandles(id, memberId, {
        venmoHandle: payVenmo,
        cashappCashtag: payCashapp,
        paypalHandle: payPaypal,
      });
      setPayingMemberId(null);
      await load();
      toast.success('Payment handles saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save payment handles.');
    }
  }

  async function onAddMember(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!memberName.trim()) return;
    setMemberError(null);
    try {
      await groupsApi.addPlaceholder(id, memberName.trim());
      setMemberName('');
      await load();
      toast.success('Added them to the group.');
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Could not add them.');
    }
  }

  const activity = useMemo<Activity[]>(() => {
    const items: Activity[] = [
      ...expenses.map((e) => ({ kind: 'expense' as const, ts: new Date(e.date).getTime(), expense: e })),
      ...settlements.map((s) => ({
        kind: 'settlement' as const,
        ts: new Date(s.createdAt).getTime(),
        settlement: s,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [expenses, settlements]);

  /*
   * One formatter for this group's money: used directly by the page and handed to everything under it
   * through the provider at the bottom of the render.
   *
   * Declared up here with the other hooks rather than beside the derived values further down, because
   * the search memo below formats amounts to match them against the query. A `const` further down the
   * function body is in its temporal dead zone when that callback runs, so searching would have thrown.
   */
  const fmt = useMemo(() => currencyFormatter(group?.currency ?? DEFAULT_CURRENCY), [group?.currency]);

  // Person/category filters are expense-specific. Text search spans the entire ledger, including
  // payments, and matches the same human labels the rows display rather than internal ids.
  const visibleActivity = useMemo(() => {
    const query = activityQuery.trim().toLocaleLowerCase();
    const memberName = (userId: string): string =>
      group?.members.find((member) => member.userId === userId)?.displayName ?? '';
    return activity.filter((item) => {
      if (categoryFilter || personFilter) {
        if (item.kind !== 'expense') return false;
        if (categoryFilter && (item.expense.category ?? 'other') !== categoryFilter) return false;
        if (!matchesPersonLens(item.expense, personFilter, relationFilter)) return false;
      }
      if (!query) return true;
      const haystack = item.kind === 'expense'
        ? [
            item.expense.description,
            categoryMeta(item.expense.category).label,
            memberName(item.expense.payerId),
            ...item.expense.splits.map((split) => memberName(split.userId)),
            fmt(item.expense.amountCents),
          ]
        : [
            memberName(item.settlement.fromUserId),
            memberName(item.settlement.toUserId),
            'payment',
            item.settlement.method ? PAYMENT_METHOD_LABELS[item.settlement.method] : '',
            fmt(item.settlement.amountCents),
          ];
      return haystack.some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [activity, activityQuery, categoryFilter, fmt, group, personFilter, relationFilter]);

  /*
   * The feed renders the most recent slice, not the whole ledger.
   *
   * A flatshare in its second year is several hundred rows, and every one of them is a card with an
   * avatar and its own entrance animation. Filtering and search still run over everything above this
   * line, so a match from last March is found and shown; only the unfiltered scroll is bounded.
   */
  const [showAllActivity, setShowAllActivity] = useState(false);
  const shownActivity = showAllActivity ? visibleActivity : visibleActivity.slice(0, ACTIVITY_PAGE);
  const hiddenActivityCount = visibleActivity.length - shownActivity.length;

  // A new set of results is a new question, so it starts from the top again rather than dumping
  // every match of a two-letter search at once.
  useEffect(() => {
    setShowAllActivity(false);
  }, [activityQuery, categoryFilter, personFilter, relationFilter]);

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
  // Who actually paid an expense. For itemized receipts we read the per-item payers
  // (falling back to the expense payer), so a split-tab receipt reads honestly instead
  // of crediting one person.
  function payerSummary(e: Expense): { avatar: string; label: string } {
    const payers =
      e.splitMethod === 'ITEMIZED' && e.items && e.items.length > 0
        ? [...new Set(e.items.map((i) => i.payerId ?? e.payerId))]
        : [e.payerId];
    const label =
      payers.length === 1
        ? `${nameOf(payers[0]!)} paid`
        : payers.length === 2
          ? `${nameOf(payers[0]!)} & ${nameOf(payers[1]!)} paid`
          : `${payers.length} people paid`;
    return { avatar: nameOf(payers[0]!), label };
  }
  const detailExpense = expenses.find((e) => e.id === detailExpenseId) ?? null;
  const balanceByUser = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
  const balanceOf = Object.fromEntries(balances.map((b) => [b.userId, b]));
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
  const totalSpent = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const monthlyPulse = spendingPulse(expenses);
  /*
   * Everything the group has spent against the number it set, not just this month.
   *
   * A trip budget is a total for one trip, so unlike the monthly pulse above it must not reset on the 1st.
   * Members rather than balances is the right divisor: a person who has paid for nothing still spent.
   */
  const budget = tripBudget(group?.budgetCents ?? null, expenses, group?.members.length ?? 0);
  // How much has already been paid back, and the even-split average across the members.
  const totalSettled = settlements.reduce((sum, s) => sum + s.amountCents, 0);
  // Payments and the outstanding balance describe one journey toward zero. Clamp at 100 because
  // manual payments can intentionally overpay an earlier split, and a progress bar past the end
  // would make an otherwise valid ledger look broken.
  const settlementJourney = totalSettled + totalUnsettled;
  const settlementProgress = settlementJourney > 0 ? Math.min(100, Math.round((totalSettled / settlementJourney) * 100)) : 0;
  const settlePlanTotal = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
  const bestSettleStep = bestSettlementStep(balances, suggested);
  const recommendedPaymentKey = bestSettleStep
    ? `${bestSettleStep.payment.fromUserId}-${bestSettleStep.payment.toUserId}`
    : null;
  const orderedSuggestions = recommendedPaymentKey
    ? [...suggested].sort((a, b) =>
        `${a.fromUserId}-${a.toUserId}` === recommendedPaymentKey
          ? -1
          : `${b.fromUserId}-${b.toUserId}` === recommendedPaymentKey
            ? 1
            : 0,
      )
    : suggested;
  const perPersonCents = group.members.length ? Math.round(totalSpent / group.members.length) : 0;
  // A brand-new group has no expenses or payments yet — show a "nothing yet" hero, not "settled".
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  const groupRecap = groupSettled && expenses.length > 0
    ? buildGroupRecap(expenses, settlements)
    : null;

  // The person lens (personFilter + relationFilter) scopes both the breakdown and the feed; the
  // category filter is a drill-down from the chart into the feed only. The lens logic is pure and
  // unit-tested in lib/activityFilters.
  const lensActive = personFilter !== null;
  const lensTotal = computeLensTotal(expenses, personFilter, relationFilter);
  // Summary answers for the whole group; the person lens belongs to the feed it sits above.
  const spendByCategory = computeSpendByCategory(expenses, null, 'involved');
  const spendTotal = computeLensTotal(expenses, null, 'involved');

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
          <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon name="wallet" size={16} /> Settle up
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => void shareSettlePlan()}
                  disabled={settleShareStatus !== null}
                  aria-label={
                    settleShareStatus === 'sharing'
                      ? 'Opening settle-up plan sharing'
                      : settleShareStatus === 'shared'
                        ? 'Settle-up plan shared'
                        : settleShareStatus === 'copied'
                          ? 'Settle-up plan copied'
                          : 'Share settle-up plan'
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
                >
                  <Icon name="share" size={13} />
                  {settleShareStatus === 'sharing' ? 'Opening…' : settleShareStatus === 'shared' ? 'Plan shared' : settleShareStatus === 'copied' ? 'Plan copied' : 'Share plan'}
                </button>
                <button
                  type="button"
                  onClick={() => void shareSettleCard()}
                  disabled={settleCardStatus !== null}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
                >
                  <Icon name="sparkles" size={13} />
                  {settleCardStatus === 'making' ? 'Making…' : settleCardStatus === 'shared' ? 'Card shared' : settleCardStatus === 'saved' ? 'Card saved' : 'Share card'}
                </button>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  paid via
                  <select
                    value={settleMethod}
                    onChange={(e) => setSettleMethod(e.target.value as PaymentMethod)}
                    aria-label="Payment method"
                    className="rounded-lg border border-line bg-field px-2 py-1 text-xs outline-none focus:border-accent"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Pay in your usual app, then mark it here so the group stays in sync.
            </p>
            <SettlementDeadline
              groupName={group.name}
              settleBy={group.settleBy}
              suggestions={suggested}
              isOwner={isOwner}
              onSave={async (settleBy) => {
                try {
                  const updated = await groupsApi.setSettlementDeadline(group.id, settleBy);
                  setGroup(updated);
                  toast.success(settleBy ? 'Settle-by deadline shared.' : 'Settle-by deadline cleared.');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Could not update the deadline.');
                  throw error;
                }
              }}
            />
            {bestSettleStep && (
              <div className="mt-3 rounded-xl border border-line bg-surface2/60 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Best next move</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {bestSettleStep.payment.fromName} pays {bestSettleStep.payment.toName}{' '}
                      <span className="tnum text-ink">{fmt(bestSettleStep.payment.amountCents)}</span>
                    </p>
                  </div>
                  <span className="tnum shrink-0 rounded-full bg-surface2 px-2.5 py-1 text-xs font-semibold text-muted">
                    −{bestSettleStep.percentOfOutstanding}%
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {bestSettleStep.remainingTransfers === 0
                    ? 'One payment settles the whole group.'
                    : bestSettleStep.clearedNames.length > 0
                      ? `Clears ${bestSettleStep.clearedNames.join(' and ')} from the list, with ${bestSettleStep.remainingTransfers} ${bestSettleStep.remainingTransfers === 1 ? 'transfer' : 'transfers'} left.`
                      : `${fmt(bestSettleStep.remainingCents)} would remain after this.`}
                </p>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface2/50 px-3 py-2 text-xs">
              <span className="text-muted">
                {suggested.length} {suggested.length === 1 ? 'transfer' : 'transfers'} left
              </span>
              <span className="tnum font-semibold text-ink">{fmt(settlePlanTotal)} remaining</span>
            </div>
            <ul className="mt-3 space-y-2">
              {orderedSuggestions.map((payment) => (
                <li
                  key={`${payment.fromUserId}-${payment.toUserId}`}
                  className={`flex flex-col gap-2 rounded-xl px-2 py-1.5 transition sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${
                    paymentInFlight === `${payment.fromUserId}-${payment.toUserId}`
                      ? 'border border-accent/20 bg-accent-soft'
                      : `${payment.fromUserId}-${payment.toUserId}` === recommendedPaymentKey
                        ? 'border border-line bg-surface2/40'
                        : 'border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <Avatar name={payment.fromName} size="sm" />
                    <span>
                      {`${payment.fromUserId}-${payment.toUserId}` === recommendedPaymentKey && suggested.length > 1 && (
                        <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Start here</span>
                      )}
                      <span className="font-medium">{payment.fromName}</span>
                      <span className="text-muted"> pays </span>
                      <span className="font-medium">{payment.toName}</span>{' '}
                      <span className="tnum font-medium">
                        {fmt(payment.amountCents)}
                      </span>
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 pl-9 sm:pl-0">
                    {payLinks(
                      group.members.find((m) => m.userId === payment.toUserId) ?? {
                        venmoHandle: null,
                        cashappCashtag: null,
                        paypalHandle: null,
                      },
                      payment.amountCents,
                      `owewell: ${group.name}`,
                    ).map((link) => (
                      <a
                        key={link.label}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          setSettleMethod(link.method);
                          setPaymentInFlight(`${payment.fromUserId}-${payment.toUserId}`);
                          play('tick');
                        }}
                        title={`Pay ${payment.toName} via ${link.label}`}
                        className="rounded-full border border-line-strong bg-surface2 px-3 py-1.5 text-xs font-medium transition hover:border-accent active:scale-[0.98]"
                      >
                        {link.label}
                      </a>
                    ))}
                    <button
                      type="button"
                      aria-expanded={paymentNudge === `${payment.fromUserId}-${payment.toUserId}`}
                      onClick={() => {
                        const key = `${payment.fromUserId}-${payment.toUserId}`;
                        setPaymentNudge(current => current === key ? null : key);
                        setPaymentPreview(null);
                        setNudgeShareStatus(null);
                      }}
                      className="px-1.5 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:text-ink hover:underline"
                    >
                      {paymentNudge === `${payment.fromUserId}-${payment.toUserId}` ? 'Close nudge' : 'Nudge'}
                    </button>
                    <button
                      type="button"
                      aria-expanded={paymentPreview === `${payment.fromUserId}-${payment.toUserId}`}
                      onClick={() => {
                        const key = `${payment.fromUserId}-${payment.toUserId}`;
                        setPaymentPreview(current => current === key ? null : key);
                        setPaymentNudge(null);
                      }}
                      className="px-1.5 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:text-ink hover:underline"
                    >
                      {paymentPreview === `${payment.fromUserId}-${payment.toUserId}` ? 'Hide preview' : 'Preview'}
                    </button>
                    <button
                      type="button"
                      disabled={settling}
                      onClick={() => void markPaid(payment)}
                      title={`Record ${payment.fromName}'s payment to ${payment.toName}`}
                      /* The only filled control in the row. Nudge and Preview are text, the pay links
                         are outlines, and this is the one that changes the ledger. */
                      className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                    >
                      {paymentInFlight === `${payment.fromUserId}-${payment.toUserId}` ? 'Sent it, mark paid' : 'Mark paid'}
                    </button>
                    {paymentInFlight === `${payment.fromUserId}-${payment.toUserId}` && (
                      <span className="basis-full text-right text-[11px] text-muted" role="status">
                        Payment app opened. Record it here once it&rsquo;s sent.
                      </span>
                    )}
                  </div>
                  {paymentNudge === `${payment.fromUserId}-${payment.toUserId}` && (
                    <div className="w-full basis-full rounded-xl border border-line bg-surface2/50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                          Make it sound like you
                        </p>
                        <div className="flex gap-1" role="group" aria-label="Reminder tone">
                          {(['gentle', 'direct', 'playful'] as NudgeTone[]).map(tone => (
                            <button
                              key={tone}
                              type="button"
                              aria-pressed={nudgeTone === tone}
                              onClick={() => setNudgeTone(tone)}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                                nudgeTone === tone
                                  ? 'border-accent bg-accent-soft text-accent'
                                  : 'border-line bg-field text-muted hover:text-ink'
                              }`}
                            >
                              {tone}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-line rounded-lg border border-line bg-field/70 px-3 py-2.5 text-xs leading-relaxed text-ink">
                        {paymentNudgeText(
                          {
                            fromName: payment.fromName,
                            toName: payment.toName,
                            amountCents: payment.amountCents,
                            groupName: group.name,
                            payUrl: payLinks(
                              group.members.find(member => member.userId === payment.toUserId) ?? {
                                venmoHandle: null,
                                cashappCashtag: null,
                                paypalHandle: null,
                              },
                              payment.amountCents,
                              `owewell: ${group.name}`,
                            )[0]?.url,
                          },
                          nudgeTone,
                          fmt,
                        )}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted">Nothing is sent automatically.</span>
                        <button
                          type="button"
                          disabled={nudgeShareStatus !== null}
                          onClick={() => void sharePaymentNudge(payment)}
                          className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                        >
                          {nudgeShareStatus === 'sharing'
                            ? 'Opening…'
                            : nudgeShareStatus === 'shared'
                              ? 'Reminder shared'
                              : nudgeShareStatus === 'copied'
                                ? 'Reminder copied'
                                : 'Send reminder'}
                        </button>
                      </div>
                    </div>
                  )}
                  {paymentPreview === `${payment.fromUserId}-${payment.toUserId}` && (
                    <div className="w-full basis-full rounded-lg border border-line bg-field/70 px-3 py-2.5" role="status">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                        After this payment
                      </p>
                      <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                        {projectBalancesAfterPayment(payment, balances).map(projected => (
                          <p key={projected.userId} className="text-xs text-muted">
                            <span className="font-medium text-ink">{projected.displayName}</span>{' '}
                            <span className="tnum">{balanceStateLabel(projected.beforeCents, fmt)}</span>
                            <span aria-hidden> → </span>
                            <span className={`tnum font-medium ${projected.becomesSettled ? 'text-pos' : 'text-ink'}`}>
                              {balanceStateLabel(projected.afterCents, fmt)}
                            </span>
                          </p>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted">
                        Preview only. Nothing changes until you mark it paid.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {activity.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
            <label className="flex min-w-[190px] flex-1 items-center gap-2 rounded-full border border-line bg-field px-3 py-1.5 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10">
              <span className="sr-only">Search activity</span>
              <input
                type="search"
                value={activityQuery}
                onChange={(event) => setActivityQuery(event.target.value)}
                placeholder="Find dinner, Alex, $24…"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
              />
              {activityQuery && (
                <button
                  type="button"
                  onClick={() => setActivityQuery('')}
                  aria-label="Clear activity search"
                  className="text-muted transition hover:text-ink"
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </label>
            <select
              value={personFilter ?? ''}
              onChange={(e) => setPersonFilter(e.target.value || null)}
              aria-label="Filter by person"
              className={`rounded-full border px-3 py-1.5 font-medium outline-none transition focus:border-accent ${
                personFilter ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-field text-muted'
              }`}
            >
              <option value="">Anyone</option>
              {group.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === user?.id ? 'You' : m.displayName}
                </option>
              ))}
            </select>
            {personFilter && (
              <select
                value={relationFilter}
                onChange={(e) => setRelationFilter(e.target.value as typeof relationFilter)}
                aria-label="Filter by relationship to the expense"
                className="rounded-full border border-accent bg-accent-soft px-3 py-1.5 font-medium text-accent outline-none transition focus:border-accent"
              >
                <option value="involved">involved</option>
                <option value="owes">owes</option>
                <option value="paid">paid</option>
              </select>
            )}
            {categoryFilter && (
              <button
                type="button"
                onClick={() => setCategoryFilter(null)}
                aria-label={`Clear ${categoryMeta(categoryFilter).label} filter`}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent transition hover:bg-accent/15"
              >
                <span aria-hidden>{categoryMeta(categoryFilter).emoji}</span>
                {categoryMeta(categoryFilter).label}
                <Icon name="x" size={12} />
              </button>
            )}
            {(activityQuery || categoryFilter || personFilter) && (
              <>
                <span className="text-faint">
                  {visibleActivity.length} {visibleActivity.length === 1 ? 'result' : 'results'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActivityQuery('');
                    setCategoryFilter(null);
                    setPersonFilter(null);
                    setRelationFilter('involved');
                  }}
                  className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}

        <section className="mt-6">
          <div className="flex items-baseline justify-end gap-3">
            <h2 className="sr-only">Activity</h2>
            {(lensActive ? lensTotal : totalSpent) > 0 && (
              <span className="tnum text-sm text-muted">
                {fmt(lensActive ? lensTotal : totalSpent)}{' '}
                {lensActive ? (relationFilter === 'owes' ? 'owed' : relationFilter === 'paid' ? 'paid' : 'spent') : 'spent'}
                {!lensActive && perPersonCents > 0 && (
                  <span className="text-faint"> · {fmt(perPersonCents)} avg/person</span>
                )}
              </span>
            )}
          </div>
          {settlements.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
              <Icon name="undo" size={13} />
              A payment&rsquo;s been recorded, so this is locked. Undo it below to edit or remove
              expenses.
            </p>
          )}
          {activity.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line p-8 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="receipt" size={20} />
              </div>
              <p className="mt-3 text-sm text-muted">
                Nothing yet. Add an expense and let the math sort itself out.
              </p>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="btn-gradient mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
              >
                <Icon name="plus" size={15} /> Add expense
              </button>
            </div>
          ) : visibleActivity.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
              Nothing in this ledger matches{activityQuery ? ` “${activityQuery.trim()}”` : ' these filters'}.{' '}
              <button
                type="button"
                onClick={() => {
                  setActivityQuery('');
                  setCategoryFilter(null);
                  setPersonFilter(null);
                  setRelationFilter('involved');
                }}
                className="font-medium text-accent hover:underline"
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {/*
                * Queued writes sit above the ledger, dimmed and inert.
                *
                * They are not expenses yet, so they are deliberately not in the balances above and
                * say so: showing them as normal rows would mean the feed and the number at the top
                * of the page disagreed, with nothing on screen to explain why.
                */}
              {pending.map((entry) => (
                <li
                  key={entry.clientId}
                  className="animate-rise flex items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 opacity-70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 animate-pulse place-items-center rounded-full bg-surface2 text-faint">
                      <Icon name="share" size={13} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-muted">{entry.description}</p>
                      <p className="truncate text-sm text-faint">
                        Waiting for signal · not counted yet
                      </p>
                    </div>
                  </div>
                  <span className="tnum shrink-0 font-semibold text-muted">{fmt(entry.amountCents)}</span>
                </li>
              ))}
              {shownActivity.map((item, i) =>
                item.kind === 'expense' ? (
                  <li
                    key={`e-${item.expense.id}`}
                    className="animate-rise surface rounded-2xl"
                    style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
                  >
                    {/*
                      * The whole row opens the detail sheet, and every action lives in there.
                      *
                      * The alternative was the four hover-revealed icons this used to carry, which are
                      * invisible on a phone and, on a desktop, put delete a stray click away from the
                      * amount you were reading.
                      */}
                    <button
                      type="button"
                      onClick={() => setDetailExpenseId(item.expense.id)}
                      aria-label={`${item.expense.description}, ${fmt(item.expense.amountCents)}. See details.`}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-surface2 active:scale-[0.99]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={payerSummary(item.expense).avatar} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            <span aria-hidden className="mr-1">
                              {categoryMeta(item.expense.category).emoji}
                            </span>
                            {item.expense.description}
                          </p>
                          <p className="truncate text-sm text-muted">
                            {payerSummary(item.expense).label} · {timeAgo(item.expense.date)}
                            {/* Only flag when it wasn't shared with the whole group; "everyone" is the
                                default, so printing it on every row would just be noise. */}
                            {item.expense.splits.length < group.members.length && (
                              <> · {item.expense.splits.length} ways</>
                            )}
                          </p>
                          {/* A correction, said plainly. Almost every one is somebody fixing their own
                              typo, so this is muted text and not a warning colour. */}
                          {item.expense.lastEdit && (
                            <p className="truncate text-xs text-faint">
                              {correctionLine(
                                item.expense.lastEdit.fields as CorrectionField[],
                                nameOf(item.expense.lastEdit.byId),
                                fmt(item.expense.lastEdit.formerAmountCents),
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="tnum font-semibold">
                          {fmt(item.expense.amountCents)}
                        </span>
                        <Icon name="chevron-right" size={16} className="text-faint" />
                      </div>
                    </button>
                  </li>
                ) : (
                  <li
                    key={`s-${item.settlement.id}`}
                    className="animate-rise group flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
                    style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-pos/30 bg-pos/10 text-pos">
                        <Icon name="check" size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          <span className="font-medium">{nameOf(item.settlement.fromUserId)}</span>
                          <span className="text-muted"> paid </span>
                          <span className="font-medium">{nameOf(item.settlement.toUserId)}</span>
                        </p>
                        <p className="text-sm text-muted">
                          {timeAgo(item.settlement.createdAt)}
                          {item.settlement.method && ` · via ${PAYMENT_METHOD_LABELS[item.settlement.method]}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="tnum font-medium text-pos">
                        {fmt(item.settlement.amountCents)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void undoSettlement(item.settlement.id)}
                        aria-label="Undo payment"
                        className="grid h-8 w-8 place-items-center rounded-full text-faint opacity-100 transition hover:bg-surface2 hover:text-neg [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                      >
                        <Icon name="undo" size={15} />
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
          {hiddenActivityCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllActivity(true)}
              className="mt-3 w-full rounded-2xl border border-line py-2.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
            >
              Show {hiddenActivityCount} older {hiddenActivityCount === 1 ? 'entry' : 'entries'}
            </button>
          )}
        </section>
        </>
      )}

      {tab === 'summary' && (
        <>
        {groupRecap && (
          <section className="mt-4 overflow-hidden rounded-3xl border border-accent/15 bg-gradient-to-br from-accent-soft/80 via-surface to-surface2 p-5 shadow-sm shadow-accent/5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">The tab, wrapped</p>
                <h2 className="mt-1 font-display text-xl font-bold text-ink">{group.name} in four numbers</h2>
                <p className="mt-1 text-sm text-muted">Nothing left to chase. Just the story of the tab.</p>
              </div>
              <span aria-hidden className="text-2xl text-accent">✦</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Total spent</span>
                <strong className="mt-1 block font-display text-lg text-ink">
                  {fmt(groupRecap.totalCents)}
                </strong>
              </div>
              <div className="min-w-0 rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Biggest moment</span>
                <strong className="mt-1 block truncate text-sm text-ink" title={groupRecap.largest?.description}>
                  {groupRecap.largest?.description ?? 'nothing yet'}
                </strong>
                {groupRecap.largest && (
                  <span className="mt-0.5 block text-xs text-muted">{fmt(groupRecap.largest.amountCents)}</span>
                )}
              </div>
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Top category</span>
                <strong className="mt-1 block text-sm text-ink">
                  {groupRecap.topCategory ? `${groupRecap.topCategory.emoji} ${groupRecap.topCategory.label}` : 'nothing yet'}
                </strong>
                {groupRecap.topCategory && (
                  <span className="mt-0.5 block text-xs text-muted">{fmt(groupRecap.topCategory.amountCents)}</span>
                )}
              </div>
              <div className="rounded-2xl border border-line/70 bg-surface/70 p-3">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-faint">Tab lifetime</span>
                <strong className="mt-1 block font-display text-lg text-ink">
                  {groupRecap.daysOpen} {groupRecap.daysOpen === 1 ? 'day' : 'days'}
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void shareSettledRecap()}
              disabled={recapShareStatus !== null}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent transition hover:border-accent/35 hover:bg-accent/10 active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
            >
              <Icon name="share" size={14} />
              {recapShareStatus === 'sharing' ? 'Opening…' : recapShareStatus === 'shared' ? 'Wrapped shared' : recapShareStatus === 'copied' ? 'Wrapped copied' : 'Share the wrapped tab'}
            </button>
          </section>
        )}

          <div className="mt-4">
              <TripBudget
                budget={budget}
                budgetCents={group.budgetCents}
                isOwner={isOwner}
                onSave={async (budgetCents) => {
                  try {
                    const updated = await groupsApi.setBudget(group.id, budgetCents);
                    setGroup(updated);
                    toast.success(budgetCents === null ? 'Budget cleared.' : 'Budget shared with the group.');
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not update the budget.');
                    throw error;
                  }
                }}
              />
          </div>

        {expenses.length > 0 && group.members.length > 1 && (
          <FrontingInsight balances={balances} expenseCount={expenses.length} />
        )}

        {spendTotal > 0 && spendByCategory.length > 1 && (
          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-muted">Where it went</h2>
              <div className="flex items-center gap-2">
                {!categoryFilter && <span className="text-xs text-faint">tap to see them</span>}
                <div className="inline-flex rounded-full border border-line p-0.5 text-xs">
                  {(['bars', 'donut'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setBreakdownView(v)}
                      aria-pressed={breakdownView === v}
                      className={`rounded-full px-2.5 py-0.5 font-medium capitalize transition ${
                        breakdownView === v ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {breakdownView === 'donut' ? (
              <SpendDonut
                data={spendByCategory}
                total={spendTotal}
                activeKey={categoryFilter}
                onSelect={filterByCategory}
              />
            ) : (
            <ul className="mt-3 space-y-1">
              {spendByCategory.map(({ meta, cents }) => {
                const active = categoryFilter === meta.key;
                return (
                  <li key={meta.key}>
                    <button
                      type="button"
                      onClick={() => filterByCategory(meta.key)}
                      aria-pressed={active}
                      aria-label={`${active ? 'Clear filter' : 'Filter activity by'} ${meta.label}`}
                      className={`-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface2 ${active ? 'bg-accent-soft' : ''}`}
                    >
                      <span className={`w-28 shrink-0 truncate text-sm ${active ? 'font-medium text-accent' : ''}`}>
                        <span aria-hidden className="mr-1.5">
                          {meta.emoji}
                        </span>
                        {meta.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(3, Math.round((cents / spendTotal) * 100))}%` }}
                        />
                      </span>
                      <span className="tnum w-20 shrink-0 text-right text-sm text-muted">
                        {fmt(cents)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        )}

        <section className="mt-8">
          <button
            type="button"
            onClick={() => setMembersOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <span className="text-sm font-medium text-muted">
              Members · {group.members.length}
            </span>
            <span className="flex items-center gap-1 text-sm text-muted">
              <span className="flex -space-x-2">
                {group.members.slice(0, 4).map((m) => (
                  <span key={m.userId} className="ring-2 ring-canvas rounded-full">
                    <Avatar name={m.displayName} size="sm" />
                  </span>
                ))}
              </span>
              <Icon
                name="chevron-right"
                size={16}
                className={`transition ${membersOpen ? 'rotate-90' : ''}`}
              />
            </span>
          </button>

          {membersOpen && (
            <div className="mt-3 animate-fade">
              <ul className="space-y-2">
                {group.members.map((member) => {
                  const label = balanceLabel(balanceByUser[member.userId] ?? 0, hasActivity, fmt);
                  const bal = balanceOf[member.userId];
                  const isSelf = member.userId === user?.id;
                  // The owner can remove a non-owner member only before any payment is recorded
                  // (removal re-splits expenses, which would break a logged settlement). There's no
                  // "leave" — to get a group off your list you archive it.
                  const canRemove =
                    isOwner && !isSelf && member.role !== 'OWNER' && settlements.length === 0;
                  return (
                    <li
                      key={member.userId}
                      className="surface flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                    >
                      {editingMemberId === member.userId ? (
                        <span className="flex w-full items-center gap-2">
                          <input
                            value={editingMemberName}
                            onChange={(e) => setEditingMemberName(e.target.value)}
                            autoFocus
                            aria-label="Member name"
                            className="flex-1 rounded-lg border border-line bg-field px-2.5 py-1.5 outline-none focus:border-accent"
                          />
                          <button
                            type="button"
                            onClick={() => void saveMemberName(member.userId)}
                            className="text-sm font-medium text-accent"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMemberId(null)}
                            className="text-sm text-muted"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : payingMemberId === member.userId ? (
                        <span className="flex w-full flex-col gap-2">
                          <span className="text-xs font-medium text-muted">
                            {member.displayName}&rsquo;s payment handles
                          </span>
                          <input
                            value={payVenmo}
                            onChange={(e) => setPayVenmo(e.target.value)}
                            placeholder="Venmo username"
                            aria-label="Venmo username"
                            autoFocus
                            className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                          />
                          <input
                            value={payCashapp}
                            onChange={(e) => setPayCashapp(e.target.value)}
                            placeholder="Cash App $cashtag"
                            aria-label="Cash App cashtag"
                            className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                          />
                          <input
                            value={payPaypal}
                            onChange={(e) => setPayPaypal(e.target.value)}
                            placeholder="PayPal.me username"
                            aria-label="PayPal.me username"
                            className="rounded-lg border border-line bg-field px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                          />
                          <span className="flex gap-3 pt-0.5">
                            <button
                              type="button"
                              onClick={() => void savePaymentHandles(member.userId)}
                              className="text-sm font-medium text-accent"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setPayingMemberId(null)}
                              className="text-sm text-muted"
                            >
                              Cancel
                            </button>
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="flex min-w-0 items-center gap-3 font-medium">
                            <Avatar name={member.displayName} />
                            <span className="flex min-w-0 flex-col">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{member.displayName}</span>
                                {member.role === 'OWNER' && (
                                  <span className="shrink-0 rounded bg-surface2 px-1.5 py-0.5 text-xs text-muted">
                                    owner
                                  </span>
                                )}
                                {member.isPlaceholder && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMemberId(member.userId);
                                      setEditingMemberName(member.displayName);
                                    }}
                                    aria-label={`Rename ${member.displayName}`}
                                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition hover:bg-surface2 hover:text-ink"
                                  >
                                    <Icon name="pencil" size={13} />
                                  </button>
                                )}
                              </span>
                              {/* One line: "paid $172.40 · share $57.00" was wrapping mid-phrase on
                                  a phone and pushing the balance out of line. */}
                              {bal && (bal.paidCents > 0 || bal.owedCents > 0) && (
                                <span className="tnum block truncate text-xs font-normal text-faint">
                                  paid {fmt(bal.paidCents)} · share {fmt(bal.owedCents)}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            {(isSelf || member.isPlaceholder) && (
                              <button
                                type="button"
                                onClick={() => startEditPayment(member)}
                                aria-label={`Payment handles for ${member.displayName}`}
                                title="Payment handles"
                                className="grid h-7 w-7 place-items-center rounded-full text-faint transition hover:bg-surface2 hover:text-ink"
                              >
                                <Icon name="wallet" size={14} />
                              </button>
                            )}
                            {label.text && (
                              <span className={`tnum text-sm font-medium ${label.tone}`}>{label.text}</span>
                            )}
                            {canRemove && (
                              <button
                                type="button"
                                onClick={() => void removeFromGroup(member.userId, balanceByUser[member.userId] ?? 0)}
                                aria-label={`Remove ${member.displayName}`}
                                title={`Remove ${member.displayName}`}
                                className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-neg"
                              >
                                <Icon name="x" size={16} />
                              </button>
                            )}
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>

              <form onSubmit={(e) => void onAddMember(e)} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Add someone by name"
                  className="flex-1 rounded-xl border border-line bg-field px-3.5 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                >
                  <Icon name="user-plus" size={16} /> Add
                </button>
              </form>
              {memberError && <p className="mt-2 text-sm font-medium text-neg">{memberError}</p>}
              <p className="mt-3 text-xs text-muted">
                Added someone by name? Use <span className="font-medium text-ink">Invite</span> up top for
                a link they can use to sign in and claim their spot.
              </p>
              {isOwner && settlements.length > 0 && (
                <p className="mt-1 text-xs text-faint">
                  Members can&rsquo;t be removed once a payment has been recorded.
                </p>
              )}
            </div>
          )}
        </section>
        </>
      )}

      {/* The floating add button appears only once there's a list to add to; the empty state owns
          the first-expense CTA, so a brand-new group doesn't show two "add expense" buttons. */}
      {activity.length > 0 && (
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
