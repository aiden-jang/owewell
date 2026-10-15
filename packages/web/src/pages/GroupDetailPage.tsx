import { PrintRecap } from '../components/PrintRecap';
import { usePageTitle } from '../hooks/usePageTitle';
import { GroupShell, GroupLoadingState } from '../components/GroupShell';
import { useNavigate, useParams } from 'react-router-dom';
import { ExpenseEditorSheets } from '../components/ExpenseEditorSheets';
import { useGroupActions } from '../lib/useGroupActions';
import { GroupActivityShortcut } from '../components/GroupActivityShortcut';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { InviteLink } from '../components/InviteLink';
import { Sheet } from '../components/Sheet';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { RecordPaymentForm } from '../components/RecordPaymentForm';
import { SettleUpPanel } from '../components/SettleUpPanel';
import { MembersPanel } from '../components/MembersPanel';
import { ActivityFeed } from '../components/ActivityFeed';
import { BalanceHero } from '../components/BalanceHero';
import { WrappedRecap } from '../components/WrappedRecap';
import { SpendBreakdown } from '../components/SpendBreakdown';
import { FrontingInsight } from '../components/FrontingInsight';
import { GroupHeader } from '../components/GroupHeader';
import { activityCsv, csvFileName } from '../lib/activityCsv';
import { useToast } from '../components/Toast';
import { groupsApi, type Balance, type GroupSummary } from '../lib/groups';
import { useMoney } from '../lib/currency';
import { useGroupLedger } from '../lib/useGroupLedger';
import { useInviteLink } from '../lib/useInviteLink';
import { liveReceipt } from '../lib/settlementReceipt';
import { SettlementReceipt } from '../components/SettlementReceipt';
import { buildGroupRecap } from '../lib/groupRecap';

export function GroupDetailPage(): ReactNode {
  const { id = '' } = useParams();
  return <GroupDetailContent key={id} id={id} />;
}

function GroupDetailContent({ id }: { id: string }): ReactNode {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const ledger = useGroupLedger(id);
  const {
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
    showSavedExpense,
    refreshPending,
    pendingCount,
  } = ledger;
  usePageTitle(group?.name ?? 'Opening group');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // All the viewer's groups, for the header switcher. Fetched once; the list rarely changes.
  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  // A "person lens" over both the breakdown and the feed: pick a person, then how they relate to
  // an expense — involved (paid or owe a share) / owes (a share they didn't pay) / paid. Null
  // person = no lens. Category is a separate drill-down from the chart into the feed only.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // Held by id, not by value: an edit or a realtime refetch replaces the object in `expenses`, and the
  // open sheet has to follow it. A deleted expense drops out of the list, which closes the sheet.
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  /*
   * Whether the feed has any rows to show, which is not the same as whether the group has history:
   * an expense with a delete waiting to be sent is already gone from the list. Deleting your last
   * one offline has to hide the floating button too, or it sits on top of the empty state's own
   * "add expense" and the screen offers the same action twice.
   */
  const ledgerHasRows = settlements.length > 0 || expenses.some((e) => !pendingDeletes.has(e.id));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentBeforeRef = useRef<Balance[] | null>(null);

  useEffect(() => {
    groupsApi
      .list()
      .then((gs) => setAllGroups(gs.filter((g) => !g.archived)))
      .catch(() => undefined);
  }, []);

  const fmt = useMoney();
  const invite = useInviteLink(group);
  const {
    settling,
    paymentReceipt,
    setPaymentReceipt,
    newShareLink,
    turnOffShareLink,
    markPaid,
    finishManualPayment,
    deleteExpense,
    toggleArchive,
    undoSettlement,
    renameGroup,
    deleteGroup,
    removeFromGroup,
    renameMember,
    saveMemberHandles,
    addMember,
  } = useGroupActions(id, ledger, invite);

  if (loadFailed || notFound || !group) {
    return <GroupLoadingState loadFailed={loadFailed} notFound={notFound} onRetry={() => void load()} />;
  }

  const nameOf = (userId: string): string =>
    group.members.find((m) => m.userId === userId)?.displayName ?? 'Someone';
  const detailExpense = expenses.find((e) => e.id === detailExpenseId) ?? null;
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === 'OWNER';
  // You can be square while the group still has debts between others, so "all settled" is about the
  // outstanding transfers rather than about any one person. The hero derives its own copy of this
  // from the same array; here it decides whether there is a wrapped recap to offer at all.
  const groupSettled = suggested.length === 0;
  // Derived rather than cleared by hand, so every path that removes a settlement gets it for free.
  const receipt = liveReceipt(paymentReceipt, settlements);
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  const groupRecap = groupSettled && expenses.length > 0 ? buildGroupRecap(expenses, settlements) : null;

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
    <GroupShell>
      <PrintRecap ledger={ledger} />
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
        onPrint={() => window.print()}
        onOpenMembers={() => setMembersOpen(true)}
      />

      {/* Above the balance, because the balance is what it makes wrong: the figure is computed by
          the server from writes that have not reached it, and a row marked "waiting" further down
          only explains itself if you happen to be looking at that row. */}
      {pendingCount > 0 && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 rounded-full border border-dashed border-line-strong py-2 text-sm text-muted"
        >
          <Icon name="share" size={14} />
          {pendingCount === 1
            ? 'One change is waiting for signal'
            : `${pendingCount} changes are waiting for signal`}
        </p>
      )}

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

      {ledgerHasRows && (
        <GroupActivityShortcut
          expenses={expenses}
          onAdd={() => setSheetOpen(true)}
          onOpen={setDetailExpenseId}
        />
      )}

      {receipt && <SettlementReceipt receipt={receipt} onClose={() => setPaymentReceipt(null)} />}

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
          isOwner={isOwner}
          onRotate={() => void newShareLink()}
          onRevoke={() => void turnOffShareLink()}
          {...(invite.needsPeople
            ? {
                headline:
                  invite.unclaimed > 0
                    ? `Send this to ${invite.unclaimed === 1 ? 'them' : 'them all'} so they can claim their spot`
                    : "Send this to the people you're splitting with",
                hint:
                  invite.unclaimed > 0
                    ? `${invite.unclaimed === 1 ? 'One person is' : `${invite.unclaimed} people are`} in here by name only. They can view the group, then choose their name and sign in to connect its balances to their account.`
                    : 'Add people by name first so they have a spot to connect. Anyone with the link can view the group.',
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
          <SpendBreakdown
            expenses={expenses}
            categoryFilter={categoryFilter}
            onSelectCategory={setCategoryFilter}
          />
        }
      />

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

      <Sheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Log a payment" protectChanges>
        <RecordPaymentForm
          groupId={group.id}
          members={group.members}
          balances={balances}
          defaultFromId={user?.id}
          suggestions={suggested}
          onQueued={(summary) => {
            setPaymentOpen(false);
            refreshPending();
            toast.success(`Payment ${summary} is queued on this device. Balances update after it syncs.`);
          }}
          onRecorded={(settlement) => {
            setPaymentOpen(false);
            const beforeBalances = paymentBeforeRef.current ?? balances;
            paymentBeforeRef.current = null;
            void finishManualPayment(settlement, beforeBalances);
          }}
        />
      </Sheet>

      <ExpenseEditorSheets
        group={group}
        detailExpense={detailExpense}
        viewerId={user?.id}
        locked={settlements.length > 0}
        onCloseDetail={() => setDetailExpenseId(null)}
        onDelete={deleteExpense}
        onSaved={(saved, message) => {
          toast.success(message);
          showSavedExpense(saved);
          void refreshLedger();
        }}
        onQueued={(description) => {
          refreshPending();
          toast.success(`Your change to "${description}" goes out when you have signal.`);
        }}
      />
    </GroupShell>
  );
}
