import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  currencyFormatter,
  DEFAULT_CURRENCY,
} from '@owewell/shared';
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { InviteLink } from '../components/InviteLink';
import { Sheet } from '../components/Sheet';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { RecordPaymentForm } from '../components/RecordPaymentForm';
import { SettleUpPanel } from '../components/SettleUpPanel';
import { MembersPanel, type PaymentHandles } from '../components/MembersPanel';
import { ActivityFeed } from '../components/ActivityFeed';
import { SummaryTab } from '../components/SummaryTab';
import { BalanceHero } from '../components/BalanceHero';
import { GroupHeader } from '../components/GroupHeader';
import { activityCsv, csvFileName } from '../lib/activityCsv';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { groupsApi, type Balance, type GroupSummary } from '../lib/groups';
import { expensesApi, receiptUrl, type Expense } from '../lib/expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { play } from '../lib/sound';
import { ExpenseDetail } from '../components/ExpenseDetail';
import { CurrencyProvider } from '../lib/currency';
import {
  drop as dropWrite,
  enqueue as enqueueWrite,
  isOffline,
} from '../lib/outbox';
import { useGroupLedger } from '../lib/useGroupLedger';
import { buildSettlementReceipt, type SettlementReceiptData } from '../lib/settlementReceipt';
import { SettlementReceipt } from '../components/SettlementReceipt';
import { buildGroupRecap } from '../lib/groupRecap';

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
  const {
    group, balances, expenses, settlements, suggested,
    notFound, loadFailed,
    pendingRows, pendingDeletes, pendingEdits,
    load, refreshLedger, setGroup,
    showSavedExpense, patchExpense, dropExpense, refreshPending,
  } = useGroupLedger(id);
  const [settling, setSettling] = useState(false);
  const [expenseMode, setExpenseMode] = useState<'simple' | 'itemized'>('simple');
  const [sheetOpen, setSheetOpen] = useState(false);
  // All the viewer's groups, for the header switcher. Fetched once; the list rarely changes.
  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
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
  /*
   * Whether the feed has any rows to show, which is not the same as whether the group has history:
   * an expense with a delete waiting to be sent is already gone from the list. Deleting your last
   * one offline has to hide the floating button too, or it sits on top of the empty state's own
   * "add expense" and the screen offers the same action twice.
   */
  const ledgerHasRows =
    settlements.length > 0 || expenses.some((e) => !pendingDeletes.has(e.id));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentBeforeRef = useRef<Balance[] | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<SettlementReceiptData | null>(null);

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
   * Photos on an expense that already exists.
   *
   * Not gated on the settle-up lock: a picture of a receipt does not move anybody's balance, so the
   * rule that stops the ledger changing after a payment has nothing to say about it. Archived groups
   * are read-only in the UI, which is why the sheet only gets these handlers when the group is live.
   */
  async function attachReceipt(expenseId: string, file: File): Promise<void> {
    try {
      await expensesApi.putReceipt(id, expenseId, file);
      patchExpense(expenseId, { hasReceipt: true });
      play('tick');
      toast.success('Photo attached.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that photo.');
    }
  }

  async function removeReceipt(expenseId: string): Promise<void> {
    try {
      await expensesApi.removeReceipt(id, expenseId);
      patchExpense(expenseId, { hasReceipt: false });
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

  useEffect(() => {
    groupsApi
      .list()
      .then((gs) => setAllGroups(gs.filter((g) => !g.archived)))
      .catch(() => undefined);
  }, []);

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
      dropExpense(expenseId);
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
      refreshPending();
      toast.success(`${name} It syncs when you have signal.`, {
        label: 'Undo',
        onClick: () => {
          dropWrite(clientId);
          refreshPending();
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

  async function renameGroup(name: string): Promise<void> {
    try {
      setGroup(await groupsApi.rename(id, name));
      toast.success('Renamed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rename the group.');
      throw err;
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
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === 'OWNER';
  // You can be square while the group still has debts between others, so "all settled" is about the
  // outstanding transfers rather than about any one person. The hero derives its own copy of this
  // from the same array; here it decides whether there is a wrapped recap to offer at all.
  const groupSettled = suggested.length === 0;
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  const groupRecap = groupSettled && expenses.length > 0
    ? buildGroupRecap(expenses, settlements)
    : null;


  /** Mint the invite link, reveal it below, and offer the share sheet where there is one. */
  async function createAndRevealInvite(): Promise<void> {
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
    const href = URL.createObjectURL(
      // BOM keeps names and descriptions with emoji/non-Latin characters intact in desktop Excel.
      new Blob(['\uFEFF', activityCsv({ expenses, settlements, balances, nameOf, fmt })], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = csvFileName(group.name);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    toast.success('Activity exported as a CSV.');
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
      <GroupHeader
        groupId={id}
        groupName={group.name}
        archived={group.archived}
        currency={group.currency}
        isOwner={isOwner}
        groups={allGroups}
        onSwitchGroup={(next) => navigate(`/groups/${next}`)}
        onRename={renameGroup}
        onChangeCurrency={changeCurrency}
        onToggleArchive={toggleArchive}
        onDelete={deleteGroup}
        onInvite={() => void createAndRevealInvite()}
        onExport={exportActivity}
      />

      <BalanceHero
        groupName={group.name}
        balances={balances}
        expenses={expenses}
        settlements={settlements}
        suggested={suggested}
        currentUserId={user?.id}
        memberCount={group.members.length}
        hasRecap={groupRecap !== null}
        onSeeWrapped={() => setTab('summary')}
        onLogPayment={() => {
          paymentBeforeRef.current = balances;
          setPaymentOpen(true);
        }}
      />


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
              refreshPending();
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
              refreshPending();
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
            refreshPending();
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
                refreshPending();
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
                refreshPending();
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
