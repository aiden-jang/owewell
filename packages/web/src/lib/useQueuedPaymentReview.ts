import { PAYMENT_METHOD_LABELS } from '@owewell/core';
import { formatMoney, participantLabels } from '@owewell/shared';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi } from './groups';
import {
  drop,
  needsPaymentReview,
  OUTBOX_STORAGE_ERROR,
  queued,
  withOutboxLock,
  type QueuedSettlement,
} from './outbox';
import { settlementsApi } from './settlements';
import { useAsyncScope } from './useAsyncScope';

export function useQueuedPaymentReview(ownerId: string | undefined, onSaved: () => void) {
  const confirm = useConfirm();
  const toast = useToast();
  const { captureScope } = useAsyncScope(ownerId);
  return async (entry: QueuedSettlement): Promise<void> => {
    if (!ownerId || entry.ownerId !== ownerId) return;
    const current = captureScope();
    const { groupId, clientId, payload } = entry;
    try {
      const [group, { balances }, history] = await Promise.all([
        groupsApi.get(groupId, ownerId),
        groupsApi.balances(groupId, ownerId),
        settlementsApi.list(groupId, ownerId),
      ]);
      if (!current()) return;
      const names = participantLabels(balances);
      const from = names.get(payload.fromUserId) ?? 'The sender';
      const to = names.get(payload.toUserId) ?? 'the recipient';
      const matching = history.some(
        (payment) =>
          payment.fromUserId === payload.fromUserId &&
          payment.toUserId === payload.toUserId &&
          payment.amountCents === payload.amountCents,
      );
      const approved = await confirm({
        title: 'Review saved payment',
        body: `“${group.name}” has a saved payment from ${from} to ${to} for ${formatMoney(payload.amountCents)}${
          payload.method ? ` via ${PAYMENT_METHOD_LABELS[payload.method]}` : ''
        }. ${matching ? 'A matching payment is already in the ledger. Record this only if a separate payment was made.' : 'Record this only if the payment was made.'}`,
        confirmLabel: 'Record payment',
        cancelLabel: 'Back',
        ...(matching ? { tone: 'danger' } : {}),
      });
      if (!approved || !current()) return;
      await withOutboxLock(ownerId, async () => {
        if (
          !current() ||
          !queued(groupId, ownerId).some((row) => row.clientId === clientId && needsPaymentReview(row))
        )
          return;
        const { suggestedVersion: _version, reviewRequired: _review, ...manual } = payload;
        await settlementsApi.record(
          groupId,
          { ...manual, clientId: payload.clientId ?? clientId, confirmedManual: true },
          ownerId,
        );
        if (!drop(clientId)) toast.error(OUTBOX_STORAGE_ERROR);
        else toast.success('Payment recorded.');
        if (current()) onSaved();
      });
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : 'Could not review that payment.');
    }
  };
}
