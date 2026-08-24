import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  type PaymentMethod,
} from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { InviteLink } from '../components/InviteLink';
import { Sheet } from '../components/Sheet';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { RecordPaymentForm } from '../components/RecordPaymentForm';
import { SettleUpPanel } from '../components/SettleUpPanel';
import { MembersPanel, type PaymentHandles } from '../components/MembersPanel';
import { ActivityFeed } from '../components/ActivityFeed';
import { BalanceHero } from '../components/BalanceHero';
import { WrappedRecap } from '../components/WrappedRecap';
import { SpendBreakdown } from '../components/SpendBreakdown';
import { FrontingInsight } from '../components/FrontingInsight';
import { GroupHeader } from '../components/GroupHeader';
import { EmptyState } from '../components/EmptyState';
import { activityCsv, csvFileName } from '../lib/activityCsv';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { groupsApi, type Balance, type GroupSummary } from '../lib/groups';
import { useMoney } from '../lib/currency';
import { expensesApi, type Expense } from '../lib/expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { ExpenseDetail } from '../components/ExpenseDetail';
import {
  drop as dropWrite,
  enqueue as enqueueWrite,
  isOffline,
} from '../lib/outbox';
import { useGroupLedger } from '../lib/useGroupLedger';
import { useInviteLink } from '../lib/useInviteLink';
import { buildSettlementReceipt, type SettlementReceiptData } from '../lib/settlementReceipt';
import { SettlementReceipt } from '../components/SettlementReceipt';
import { buildGroupRecap } from '../lib/groupRecap';

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex-1">
      <AppHeader />
      {/*
        * ── Rhythm ──
        *
        * One gap between blocks, owned here. Each block used to carry its own top margin, so the
        * distance between two of them was decided by whichever was written second: the hero said
        * mt-5, the settle-up panel mt-6, the recap mt-4. Three gaps between peers in
        * one column, which is what made the spacing read as uneven.
        *
        * Anything that needs a different distance from its neighbour is saying it belongs to that
        * neighbour, and should be nested inside it rather than adjusting the gap.
        */}
      <main className="mx-auto flex w-full max-w-2xl animate-rise flex-col gap-5 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8">
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
    showSavedExpense, dropExpense, refreshPending,
  } = useGroupLedger(id);
  const [settling, setSettling] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // All the viewer's groups, for the header switcher. Fetched once; the list rarely changes.
  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  // A "person lens" over both the breakdown and the feed: pick a person, then how they relate to
  // an expense — involved (paid or owe a share) / owes (a share they didn't pay) / paid. Null
  // person = no lens. Category is a separate drill-down from the chart into the feed only.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // "Where it went" can render as bars (default, easiest to compare) or a part-to-whole donut.
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
      } else {
        // No refetch, so no receipt to render. The toast is the fallback confirmation, not the
        // normal one: see `finishManualPayment`.
        toast.success('Payment logged.');
      }
      return true;
    } catch {
      toast.error('Could not record that payment.');
      return false;
    } finally {
      setSettling(false);
    }
  }

  async function finishManualPayment(settlement: Settlement, beforeBalances: Balance[]): Promise<void> {
    setPaymentOpen(false);
    /*
     * No toast on the way out, on purpose.
     *
     * Recording a payment used to say the same thing three times: a toast, a redrawn ledger, and the
     * receipt card below. The card is the one that earns it — it names the amount, both sides, what
     * each balance was and became, and whether that cleared the group. A toast on top was a summary
     * of the thing sitting directly underneath it.
     */
    const latest = await refreshLedger();
    if (latest) {
      setPaymentReceipt(buildSettlementReceipt(settlement, beforeBalances, latest.balances, latest.suggested));
    } else {
      toast.success('Payment logged.');
    }
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
      void refreshLedger();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not put that back.');
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
  const fmt = useMoney();

  const invite = useInviteLink(group);

  if (loadFailed) {
    return (
      <Shell>
        <EmptyState
          tone="problem"
          icon="wallet"
          title="Couldn't load this group."
          body="Probably a hiccup on our end, not you."
          action={
            <button
              type="button"
              onClick={() => void load()}
              className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              Try again
            </button>
          }
        />
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <EmptyState
          tone="problem"
          icon="users"
          title="That group went missing. Or was never yours."
          body="It may have been deleted, or you're not a member."
          action={
            <Link
              to="/"
              className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]"
            >
              <Icon name="arrow-left" size={15} /> Back to your groups
            </Link>
          }
        />
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

  return (
    <Shell>
      <GroupHeader
        groupId={id}
        groupName={group.name}
        archived={group.archived}
        isOwner={isOwner}
        groups={allGroups}
        onSwitchGroup={(next) => navigate(`/groups/${next}`)}
        onRename={renameGroup}
        onToggleArchive={toggleArchive}
        onDelete={deleteGroup}
        onInvite={() => void invite.reveal()}
        onExport={exportActivity}
        onOpenMembers={() => setMembersOpen(true)}
      />

      <BalanceHero
        groupName={group.name}
        balances={balances}
        expenses={expenses}
        settlements={settlements}
        suggested={suggested}
        currentUserId={user?.id}
        members={group.members}
        onOpenMembers={() => setMembersOpen(true)}
        onLogPayment={() => {
          paymentBeforeRef.current = balances;
          setPaymentOpen(true);
        }}
      />


      {paymentReceipt && (
        <SettlementReceipt receipt={paymentReceipt} onClose={() => setPaymentReceipt(null)} />
      )}

      {/*
        * One block, two readings. While the group still needs people this is the obvious next
        * thing to do and says so; once they are in, it is just the link, kept around because
        * somebody always needs it again.
        */}
      {invite.link && (
        <InviteLink
          link={invite.link}
          copied={invite.copied}
          onCopy={() => void invite.copy()}
          {...(invite.needsPeople
            ? {
                headline:
                  invite.unclaimed > 0
                    ? `Send this to ${invite.unclaimed === 1 ? 'them' : 'them all'} so they can claim their spot`
                    : "Send this to the people you're splitting with",
                hint:
                  invite.unclaimed > 0
                    ? `${invite.unclaimed === 1 ? 'One person is' : `${invite.unclaimed} people are`} in here by name only. This link lets them sign in and take over their own spot.`
                    : "It's just you in here so far. Anyone with the link can see the group and claim their spot.",
              }
            : {})}
        />
      )}

      {/*
        * The same slot, before and after.
        *
        * A recap only exists once there is nothing left to transfer, so these two can never both
        * apply. That makes one place on the page read "here is what to pay" and then "here is what
        * it came to", instead of two places you have to know about.
        */}
      {suggested.length > 0 ? (
        <SettleUpPanel
          group={group}
          suggested={suggested}
          balances={balances}
          settling={settling}
          onMarkPaid={markPaid}
        />
      ) : (
        groupRecap && (
          <WrappedRecap
            groupName={group.name}
            recap={groupRecap}
            settlements={settlements}
            memberCount={group.members.length}
          />
        )
      )}

      {expenses.length > 0 && group.members.length > 1 && (
        <FrontingInsight balances={balances} expenseCount={expenses.length} />
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
        breakdown={
          <SpendBreakdown expenses={expenses} categoryFilter={categoryFilter} onSelectCategory={setCategoryFilter} />
        }
      />


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

      {/* Roster management, out of the spending column and behind the group menu where it belongs. */}
      <Sheet open={membersOpen} onClose={() => setMembersOpen(false)} title="Members">
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
      </Sheet>

      <AddExpenseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        groupId={group.id}
        members={group.members}
        onCreated={(saved, mode) => {
          setSheetOpen(false);
          toast.success(mode === 'itemized' ? 'Receipt added to the tab.' : 'Added to the tab.');
          showSavedExpense(saved);
          void refreshLedger();
        }}
        onQueued={(description) => {
          setSheetOpen(false);
          refreshPending();
          toast.success(`Kept "${description}". It goes out when you have signal.`);
        }}
      />

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
  );
}
