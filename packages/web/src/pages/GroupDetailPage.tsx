import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Money } from '@owewell/shared';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, categoryMeta, type PaymentMethod } from '@owewell/core';
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
import { expensesApi, type Expense } from '../lib/expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { payLinks } from '../lib/payLinks';
import { ApiError } from '../lib/api';
import { useGroupRealtime } from '../hooks/useGroupRealtime';
import { play } from '../lib/sound';

function balanceLabel(netCents: number, hasActivity: boolean): { text: string; tone: string } {
  // No expenses yet means nobody is settled OR unsettled — there's just nothing owed. Don't label
  // a brand-new member "settled up"; that only makes sense once there's been something to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = Money.fromCents(Math.abs(netCents)).format();
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Activity =
  | { kind: 'expense'; ts: number; expense: Expense }
  | { kind: 'settlement'; ts: number; settlement: Settlement };

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex-1">
      <AppHeader />
      <main className="mx-auto max-w-2xl animate-rise px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8">
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
  // "Where it went" can render as bars (default, easiest to compare) or a part-to-whole donut.
  const [breakdownView, setBreakdownView] = useState<'bars' | 'donut'>('bars');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [payingMemberId, setPayingMemberId] = useState<string | null>(null);
  const [payVenmo, setPayVenmo] = useState('');
  const [payCashapp, setPayCashapp] = useState('');
  const [payPaypal, setPayPaypal] = useState('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('cash');
  const [settleShareStatus, setSettleShareStatus] = useState<'sharing' | 'shared' | 'copied' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

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

  async function refreshLedger(): Promise<SuggestedPayment[] | null> {
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
      return s;
    } catch {
      toast.error('Could not load the latest changes. Reload if the numbers look off.');
      return null;
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
      await settlementsApi.record(id, {
        fromUserId: payment.fromUserId,
        toUserId: payment.toUserId,
        amountCents: payment.amountCents,
        method: settleMethod,
      });
      const stillOwed = await refreshLedger();
      // Clearing the last debt in the group is a different event from clearing one of five, and the
      // same fetch that redraws the list already knows which just happened.
      const allSettled = stillOwed?.length === 0;
      play(allSettled ? 'allSettled' : 'settled');
      toast.success(
        allSettled
          ? 'Everyone is settled up.'
                    : `Recorded a ${PAYMENT_METHOD_LABELS[settleMethod].toLowerCase()} payment from ${payment.fromName} to ${payment.toName}.`,
      );
    } catch {
      toast.error('Could not record that payment.');
    } finally {
      setSettling(false);
    }
  }

  async function shareSettlePlan(): Promise<void> {
    if (!group || suggested.length === 0) return;
    const lines = suggested.map(
      (payment) => `• ${payment.fromName} pays ${payment.toName} ${Money.fromCents(payment.amountCents).format()}`,
    );
    const total = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
    const transferLabel = suggested.length === 1 ? 'transfer' : 'transfers';
    const text = `${group.name} settle-up\n${Money.fromCents(total).format()} across ${suggested.length} ${transferLabel}\n\n${lines.join('\n')}`;
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

  async function deleteExpense(expenseId: string): Promise<void> {
    const ok = await confirm({
      title: 'Delete this expense?',
      body: 'It comes off the list and everyone’s balances recalculate.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await expensesApi.remove(id, expenseId);
      await refreshLedger();
      toast.success('Expense deleted.');
    } catch {
      toast.error('Could not delete that expense.');
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

  // With any filter active, the feed narrows to matching expenses (settlements have no category
  // or payer in this sense, so they drop out while filtering).
  const visibleActivity = useMemo(() => {
    if (!categoryFilter && !personFilter) return activity;
    return activity.filter(
      (it) =>
        it.kind === 'expense' &&
        (!categoryFilter || (it.expense.category ?? 'other') === categoryFilter) &&
        matchesPersonLens(it.expense, personFilter, relationFilter),
    );
  }, [activity, categoryFilter, personFilter, relationFilter]);

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
  // How much has already been paid back, and the even-split average across the members.
  const totalSettled = settlements.reduce((sum, s) => sum + s.amountCents, 0);
  const perPersonCents = group.members.length ? Math.round(totalSpent / group.members.length) : 0;
  // A brand-new group has no expenses or payments yet — show a "nothing yet" hero, not "settled".
  const hasActivity = expenses.length > 0 || settlements.length > 0;

  // The person lens (personFilter + relationFilter) scopes both the breakdown and the feed; the
  // category filter is a drill-down from the chart into the feed only. The lens logic is pure and
  // unit-tested in lib/activityFilters.
  const lensActive = personFilter !== null;
  const spendByCategory = computeSpendByCategory(expenses, personFilter, relationFilter);
  const lensTotal = computeLensTotal(expenses, personFilter, relationFilter);

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

      <div className="glass mt-5 rounded-3xl p-6 sm:p-7">
        <p className="text-sm font-medium text-muted">
          {!hasActivity
            ? 'Nothing on the tab yet'
            : settled
              ? 'Your standing here'
              : owed
                ? "You're owed"
                : 'You owe'}
        </p>
        <p
          className={`mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl ${
            settled ? 'text-ink' : owed ? 'text-gradient' : 'text-neg'
          }`}
        >
          {!hasActivity ? (
            'Nothing yet'
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
            {Money.fromCents(totalUnsettled).format()} still unsettled across the group
          </p>
        )}
        {totalSettled > 0 && (
          <p className="mt-1 text-xs text-faint">
            {Money.fromCents(totalSettled).format()} settled so far
          </p>
        )}
        {!hasActivity ? (
          <p className="mt-4 text-sm text-muted">Add an expense to get the tab going.</p>
        ) : group.members.length < 2 ? (
          <p className="mt-4 text-sm text-muted">Add someone else before you can log a payment.</p>
        ) : (
          <button
            type="button"
            onClick={() => setPaymentOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent transition hover:underline"
          >
            <Icon name="wallet" size={15} /> Log a payment
          </button>
        )}
      </div>

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
        <section className="mt-6 rounded-2xl border border-accent/25 bg-accent-soft p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-accent">
              <Icon name="wallet" size={16} /> Settle up
            </h2>
            <div className="flex items-center gap-2">
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
                className="inline-flex items-center gap-1 text-xs font-medium text-accent transition hover:underline disabled:cursor-default disabled:opacity-70"
              >
                <Icon name="share" size={13} />
                {settleShareStatus === 'sharing' ? 'Opening…' : settleShareStatus === 'shared' ? 'Plan shared' : settleShareStatus === 'copied' ? 'Plan copied' : 'Share plan'}
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
          <ul className="mt-3 space-y-2">
            {suggested.map((payment) => (
              <li
                key={`${payment.fromUserId}-${payment.toUserId}`}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Avatar name={payment.fromName} size="sm" />
                  <span>
                    <span className="font-medium">{payment.fromName}</span>
                    <span className="text-muted"> pays </span>
                    <span className="font-medium">{payment.toName}</span>{' '}
                    <span className="tnum font-medium">
                      {Money.fromCents(payment.amountCents).format()}
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
                      onClick={() => setSettleMethod(link.method)}
                      title={`Pay ${payment.toName} via ${link.label}`}
                      className="rounded-full border border-line-strong bg-surface2 px-3 py-1.5 text-xs font-medium transition hover:border-accent active:scale-[0.98]"
                    >
                      {link.label}
                    </a>
                  ))}
                  <button
                    type="button"
                    disabled={settling}
                    onClick={() => void markPaid(payment)}
                    title={`Record ${payment.fromName}'s payment to ${payment.toName}`}
                    className="rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98] disabled:opacity-60"
                  >
                    Mark paid
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activity.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
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
          {(categoryFilter || personFilter) && (
            <>
              <span className="text-faint">
                {visibleActivity.length} {visibleActivity.length === 1 ? 'expense' : 'expenses'}
              </span>
              <button
                type="button"
                onClick={() => {
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

      {lensTotal > 0 && spendByCategory.length > 1 && (
        <section className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted">Where it went</h2>
            <div className="flex items-center gap-2">
              {!categoryFilter && <span className="text-xs text-faint">tap to filter</span>}
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
              total={lensTotal}
              activeKey={categoryFilter}
              onSelect={(key) => setCategoryFilter((prev) => (prev === key ? null : key))}
            />
          ) : (
          <ul className="mt-3 space-y-1">
            {spendByCategory.map(({ meta, cents }) => {
              const active = categoryFilter === meta.key;
              return (
                <li key={meta.key}>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter((prev) => (prev === meta.key ? null : meta.key))}
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
                        style={{ width: `${Math.max(3, Math.round((cents / lensTotal) * 100))}%` }}
                      />
                    </span>
                    <span className="tnum w-20 shrink-0 text-right text-sm text-muted">
                      {Money.fromCents(cents).format()}
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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">Activity</h2>
          {(lensActive ? lensTotal : totalSpent) > 0 && (
            <span className="tnum text-sm text-muted">
              {Money.fromCents(lensActive ? lensTotal : totalSpent).format()}{' '}
              {lensActive ? (relationFilter === 'owes' ? 'owed' : relationFilter === 'paid' ? 'paid' : 'spent') : 'spent'}
              {!lensActive && perPersonCents > 0 && (
                <span className="text-faint"> · {Money.fromCents(perPersonCents).format()} avg/person</span>
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
            No expenses match this filter.{' '}
            <button
              type="button"
              onClick={() => {
                setCategoryFilter(null);
                setPersonFilter(null);
                setRelationFilter('involved');
              }}
              className="font-medium text-accent hover:underline"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {visibleActivity.map((item, i) =>
              item.kind === 'expense' ? (
                <li
                  key={`e-${item.expense.id}`}
                  className="animate-rise group surface flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                  style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
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
                      <p className="text-sm text-muted">
                        {payerSummary(item.expense).label} · {timeAgo(item.expense.date)}
                        {/* Only flag when it wasn't shared with the whole group; "everyone" is the
                            default, so printing it on every row would just be noise. */}
                        {item.expense.splits.length < group.members.length && (
                          <> · split {item.expense.splits.length} ways</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="tnum font-semibold">
                      {Money.fromCents(item.expense.amountCents).format()}
                    </span>
                    {/* Once a payment is recorded the ledger locks: no editing or deleting. */}
                    {settlements.length === 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingExpense(item.expense)}
                          aria-label={`Edit ${item.expense.description}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint opacity-100 transition hover:bg-surface2 hover:text-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteExpense(item.expense.id)}
                          aria-label={`Delete ${item.expense.description}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint opacity-100 transition hover:bg-surface2 hover:text-neg [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                        >
                          <Icon name="x" size={16} />
                        </button>
                      </>
                    )}
                  </div>
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
                      {Money.fromCents(item.settlement.amountCents).format()}
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
      </section>

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
                const label = balanceLabel(balanceByUser[member.userId] ?? 0, hasActivity);
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
                            {bal && (bal.paidCents > 0 || bal.owedCents > 0) && (
                              <span className="tnum text-xs font-normal text-faint">
                                paid {Money.fromCents(bal.paidCents).format()} · share{' '}
                                {Money.fromCents(bal.owedCents).format()}
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
              expenseMode === 'simple' ? 'btn-gradient' : 'text-muted hover:text-ink'
            }`}
          >
            Split a total
          </button>
          <button
            type="button"
            onClick={() => setExpenseMode('itemized')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              expenseMode === 'itemized' ? 'btn-gradient' : 'text-muted hover:text-ink'
            }`}
          >
            Itemize a receipt
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          {expenseMode === 'simple'
            ? 'One amount for the whole group — split evenly, or by custom amounts, shares, or percent.'
            : 'People ordered different things? Add each line item plus tax and tip, and we work out what everyone owes.'}
        </p>
        {expenseMode === 'simple' ? (
          <AddExpenseForm
            key={`simple-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={() => {
              setSheetOpen(false);
              play('add');
              toast.success('Added to the tab.');
              void refreshLedger();
            }}
          />
        ) : (
          <AddItemizedExpenseForm
            key={`itemized-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={() => {
              setSheetOpen(false);
              play('add');
              toast.success('Receipt added to the tab.');
              void refreshLedger();
            }}
          />
        )}
      </Sheet>

      <Sheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Log a payment">
        <RecordPaymentForm
          groupId={group.id}
          members={group.members}
          defaultFromId={user?.id}
          onRecorded={() => {
            setPaymentOpen(false);
            play('settled');
            toast.success('Payment logged.');
            void refreshLedger();
          }}
        />
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
              onCreated={() => {
                setEditingExpense(null);
                play('tick');
                toast.success('Receipt updated.');
                void refreshLedger();
              }}
            />
          ) : (
            <AddExpenseForm
              key={`edit-${editingExpense.id}`}
              groupId={group.id}
              members={group.members}
              editing={editingExpense}
              onCreated={() => {
                setEditingExpense(null);
                play('tick');
                toast.success('Expense updated.');
                void refreshLedger();
              }}
            />
          ))}
      </Sheet>
    </Shell>
  );
}
