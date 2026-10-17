import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import type { PaymentHandles } from '../components/MembersPanel';
import { groupsApi, type Balance } from './groups';
import { expensesApi } from './expenses';
import { settlementsApi, type Settlement, type SuggestedPayment } from './settlements';
import { drop as dropWrite, enqueue as enqueueWrite, isOffline } from './outbox';
import { formatMoney as fmt } from '@owewell/shared';
import type { GroupLedger } from './useGroupLedger';
import type { InviteLink } from './useInviteLink';
import { buildSettlementReceipt, type SettlementReceiptData } from './settlementReceipt';

/** Confirmations, ledger writes and their receipts for the current group. */
export function useGroupActions(id: string, ledger: GroupLedger, invite: InviteLink) {
  const {
    group,
    balances,
    expenses,
    refreshLedger,
    setGroup,
    dropExpense,
    refreshPending,
    showSavedExpense,
    load,
  } = ledger;
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [settling, setSettling] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<SettlementReceiptData | null>(null);

  async function newShareLink(): Promise<void> {
    const ok = await confirm({
      title: 'Make a new link?',
      body: 'Every copy of the current link stops working, including ones you have already sent. Members stay members.',
      confirmLabel: 'New link',
    });
    if (ok) await invite.rotate();
  }

  async function turnOffShareLink(): Promise<void> {
    const ok = await confirm({
      title: 'Turn the link off?',
      body: 'Nobody can open the group from a link until you make a new one. Members stay members.',
      confirmLabel: 'Turn off',
      tone: 'danger',
    });
    if (ok) await invite.revoke();
  }

  /** Resolves true when the payment reached the ledger, which is the panel's cue to reset the row. */
  async function markPaid(payment: SuggestedPayment, method: PaymentMethod): Promise<boolean> {
    const ok = await confirm({
      title: 'Record this payment?',
      body: `${payment.fromName} paid ${payment.toName} ${fmt(payment.amountCents)} via ${PAYMENT_METHOD_LABELS[method]}. This updates the group’s balances. No money is sent by owewell.`,
      confirmLabel: 'Record payment',
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
        setPaymentReceipt(
          buildSettlementReceipt(settlement, beforeBalances, latest.balances, latest.suggested),
        );
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
    /*
     * No toast on the way out, on purpose. The receipt card below names the amount, both sides,
     * what each balance was and became, and whether that cleared the group — a toast on top would
     * summarise the thing sitting directly underneath it.
     */
    const latest = await refreshLedger();
    if (latest) {
      setPaymentReceipt(
        buildSettlementReceipt(settlement, beforeBalances, latest.balances, latest.suggested),
      );
    } else {
      toast.success('Payment logged.');
    }
  }

  // Undo restores the soft-deleted row and its original odd-cent allocation.
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

  // Let editor-specific callers handle failures; announce success only after writes and refresh complete.
  async function removeFromGroup(targetUserId: string, netCents: number): Promise<void> {
    const reSplit =
      netCents !== 0
        ? 'Their share of the expenses re-splits among everyone else (nothing gets marked as paid). '
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

  return {
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
  };
}
