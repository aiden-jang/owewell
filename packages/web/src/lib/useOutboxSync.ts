import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import { Money } from '@owewell/shared';
import { expensesApi } from './expenses';
import { settlementsApi } from './settlements';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { useAsyncScope } from './useAsyncScope';
import { useQueuedPaymentReview } from './useQueuedPaymentReview';
import { rememberSyncedDeletion, type UndoableDeletion } from './recentDeletions';
import { useUndoableDeletions } from './useUndoableDeletions';
import {
  adoptWrites,
  drop,
  queueDeleteUndo,
  flush,
  isConflict,
  isDelete,
  isOffline,
  OUTBOX_STORAGE_ERROR,
  pauseFor,
  queued,
  setFailure,
  unassignedWrites,
  isAlreadyDone,
  subscribe,
  withOutboxLock,
  type FlushResult,
  type QueuedDelete,
  type QueuedSettlement,
  type QueuedWrite,
} from './outbox';

// Dashboard sync covers all groups; a group screen refreshes only its own ledger.

/** Send one queued write. The four kinds differ in exactly the ways the outbox comments describe. */
function sendQueuedWrite(entry: QueuedWrite, ownerId: string): Promise<unknown> {
  switch (entry.kind) {
    case 'settlement':
      return settlementsApi.record(
        entry.groupId,
        {
          ...entry.payload,
          clientId: entry.payload.clientId ?? entry.clientId,
          ...(entry.payload.suggestedVersion === undefined
            ? entry.manual
              ? { confirmedManual: true }
              : { reviewRequired: true }
            : {}),
        },
        ownerId,
      );
    case 'edit':
      return expensesApi.update(
        entry.groupId,
        entry.expenseId,
        entry.payload as CreateExpensePayload,
        ownerId,
      );
    case 'edit-itemized':
      return expensesApi.updateItemized(
        entry.groupId,
        entry.expenseId,
        entry.payload as CreateItemizedPayload,
        ownerId,
      );
    case 'delete':
      // A queued delete finding nothing to delete got what it wanted, so it leaves the queue rather
      // than being reported as a failure the person has to do something about.
      return expensesApi
        .remove(entry.groupId, entry.expenseId, ownerId, entry.clientId, entry.expectedVersion)
        .catch((err: unknown) => {
          if (!isAlreadyDone(err)) throw err;
          return false;
        });
    case 'restore':
      return expensesApi
        .restore(entry.groupId, entry.expenseId, entry.clientId, ownerId)
        .catch((err: unknown) => {
          if (!isAlreadyDone(err)) throw err;
        });
    case 'itemized':
      return expensesApi.createItemized(entry.groupId, entry.payload as CreateItemizedPayload, ownerId);
    default:
      return expensesApi.create(entry.groupId, entry.payload as CreateExpensePayload, ownerId);
  }
}

export interface OutboxSync {
  paused: FlushResult['paused'] | 'conflict' | 'delete-conflict';
  syncing: boolean;
  unassigned: number;
  failed: QueuedWrite[];
  undoableDeletions: UndoableDeletion[];
  undoingDelete: string | null;
  undoDelete: (entry: QueuedDelete) => Promise<void>;
  reviewPayment: (entry: QueuedSettlement) => Promise<void>;
  recover: () => Promise<void>;
  retry: () => Promise<void>;
  retryFailed: (entry: QueuedWrite) => Promise<void>;
  discardFailed: (entry: QueuedWrite) => Promise<void>;
}

export function useOutboxSync({
  groupId,
  ownerId,
  onChanged,
  onQueueChanged,
}: {
  /** Limits the sync to one group. Omit to drain everything, which is what the dashboard does. */
  groupId?: string;
  ownerId?: string | undefined;
  /** Something reached the server, so whatever this screen shows is now stale. */
  onChanged: () => void;
  /** The queue itself moved, for screens that render what is still waiting. */
  onQueueChanged?: () => void;
}): OutboxSync {
  const toast = useToast();
  const confirm = useConfirm();
  const flushing = useRef<(() => boolean) | null>(null);
  const { captureScope } = useAsyncScope(JSON.stringify([groupId, ownerId]));
  const [unassigned, setUnassigned] = useState(() => unassignedWrites(groupId).length);
  const [failed, setFailed] = useState<QueuedWrite[]>([]);
  const undoableDeletions = useUndoableDeletions(ownerId, groupId);
  const [undoingDelete, setUndoingDelete] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [paused, setPaused] = useState<OutboxSync['paused']>();
  // Held in refs so the callbacks can change every render without restarting the effect below.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const reviewPayment = useQueuedPaymentReview(ownerId, () => changed.current());
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;

  const run = useCallback(async (): Promise<void> => {
    if (!ownerId || flushing.current?.()) return;
    const current = captureScope();
    flushing.current = current;
    setSyncing(true);
    const send = (entry: QueuedWrite) => sendQueuedWrite(entry, ownerId);
    const underLock = async <T>(action: () => Promise<T>): Promise<T> => withOutboxLock(ownerId, action);
    let changedAgain: string | undefined;
    try {
      while (current()) {
        const result = await underLock(async () => {
          if (current()) return flush(send, groupId, ownerId);
        });
        if (!result || !current()) return;
        setPaused(result.paused);
        queueChanged.current?.();

        if (result.sent > 0) {
          toast.success(
            result.sent === 1 ? 'Sent the change that was waiting.' : `Sent ${result.sent} waiting changes.`,
          );
          changed.current();
        }
        const entry = result.conflicted[0];
        if (!entry || result.paused) return;
        const deleting = isDelete(entry);
        const stillQueued = () => {
          const latest = queued(groupId, ownerId).find((row) => row.clientId === entry.clientId);
          return !!latest && JSON.stringify(latest) === JSON.stringify(entry);
        };

        let expense;
        try {
          expense = (await expensesApi.list(entry.groupId, ownerId)).find(
            (row) => row.id === entry.expenseId,
          );
        } catch (error) {
          if (current()) {
            setPaused(pauseFor(error) ?? 'temporary');
            toast.error('Couldn’t load the ledger version. Your change is still waiting on this device.');
          }
          return;
        }
        if (!current()) return;
        if (!expense || !Number.isSafeInteger(expense.version)) {
          const kept = await underLock(
            async () =>
              current() &&
              (!stillQueued() ||
                (!expense && deleting
                  ? drop(entry.clientId)
                  : setFailure(entry.clientId, ownerId, 'This expense is no longer available.'))),
          );
          if (!kept) {
            if (current()) setPaused('storage');
            return;
          }
          continue;
        }
        const { version, description, amountCents } = expense;
        let dismissed = false;
        const keepMine = await confirm({
          title:
            changedAgain === entry.clientId
              ? `“${entry.description}” changed again`
              : `“${entry.description}” changed while you were offline`,
          body: deleting
            ? `The ledger now shows “${description}” for ${Money.fromCents(amountCents).format()}. Review this version before deleting it.`
            : `The ledger shows “${description}” for ${Money.fromCents(amountCents).format()}. Your edit is “${entry.description}” for ${Money.fromCents(entry.amountCents).format()}. Applying yours replaces the ledger entry, including its split details.`,
          confirmLabel: deleting ? 'Delete expense' : 'Apply mine',
          cancelLabel: deleting ? 'Keep expense' : 'Keep theirs',
          tone: deleting ? 'danger' : 'default',
          onDismiss: () => {
            dismissed = true;
          },
        });
        if (!current()) return;
        if (dismissed) {
          setPaused(deleting ? 'delete-conflict' : 'conflict');
          return;
        }

        // Another tab can sync while the prompt is open. Recheck before acting on the decision.
        const proceed = await underLock(async () => {
          if (!current()) return false;
          if (!stillQueued()) return true;
          if (keepMine) {
            try {
              const sent = await send(
                deleting
                  ? { ...entry, expectedVersion: version }
                  : { ...entry, payload: { ...entry.payload, expectedVersion: version } },
              );
              if (deleting && sent !== false && !rememberSyncedDeletion(entry)) {
                if (current()) setPaused('storage');
                return false;
              }
              if (current()) changed.current();
            } catch (error) {
              if (isConflict(error)) {
                changedAgain = entry.clientId;
                return true;
              }
              if (current()) {
                const paused = pauseFor(error);
                if (!isOffline(error) && !paused) {
                  const message = error instanceof Error ? error.message : 'Could not apply your change.';
                  if (!setFailure(entry.clientId, ownerId, message)) setPaused('storage');
                } else {
                  setPaused(paused);
                  toast.error(
                    isOffline(error)
                      ? 'Still offline. Your change is waiting on this device.'
                      : 'Could not apply your change. It is still waiting.',
                  );
                }
              }
              return false;
            }
          }
          changedAgain = undefined;
          if (drop(entry.clientId)) return true;
          if (current()) setPaused('storage');
          return false;
        });
        if (!proceed) return;
      }
    } finally {
      if (flushing.current === current) flushing.current = null;
      if (current()) setSyncing(false);
    }
  }, [captureScope, confirm, groupId, ownerId, toast]);

  const recover = useCallback(async () => {
    if (!ownerId) return;
    const current = captureScope();
    const entry = unassignedWrites(groupId)[0];
    if (!entry) return;
    const approved = await confirm({
      title: 'Is this your saved change?',
      body: `“${entry.description}” was saved by an older version of Owewell. Only continue if you entered it under this account.`,
      confirmLabel: 'Sync this change',
      cancelLabel: 'Leave on device',
    });
    if (!approved || !current()) return;
    if (!adoptWrites(ownerId, new Set([entry.clientId]))) {
      toast.error(OUTBOX_STORAGE_ERROR);
      return;
    }
    await run();
  }, [captureScope, confirm, groupId, ownerId, run, toast]);

  async function retryFailed(entry: QueuedWrite): Promise<void> {
    if (!ownerId || flushing.current?.() || entry.ownerId !== ownerId) return;
    if (!setFailure(entry.clientId, ownerId)) {
      toast.error(OUTBOX_STORAGE_ERROR);
      return;
    }
    await run();
  }

  async function discardFailed(entry: QueuedWrite): Promise<void> {
    if (!ownerId || entry.ownerId !== ownerId) return;
    const current = captureScope();
    const approved = await confirm({
      title: 'Discard this saved change?',
      body: `“${entry.description}” will be removed from this device.`,
      confirmLabel: 'Discard change',
      tone: 'danger',
    });
    if (approved && current() && !drop(entry.clientId)) toast.error(OUTBOX_STORAGE_ERROR);
  }

  async function undoDelete(entry: QueuedDelete): Promise<void> {
    if (!ownerId || entry.ownerId !== ownerId || undoingDelete) return;
    setUndoingDelete(entry.clientId);
    try {
      await withOutboxLock(ownerId, async () => {
        // A disconnected delete may have landed. Persist the inverse before asking the server.
        if (!queueDeleteUndo(entry)) {
          toast.error(OUTBOX_STORAGE_ERROR);
          return;
        }
        try {
          await expensesApi.restore(entry.groupId, entry.expenseId, entry.clientId, ownerId);
        } catch (error) {
          if (!isAlreadyDone(error)) {
            if (isOffline(error) || pauseFor(error)) {
              toast.success('Undo is saved on this device and will sync when you reconnect.');
            } else {
              const message = error instanceof Error ? error.message : 'Could not undo that deletion.';
              toast.error(setFailure(entry.clientId, ownerId, message) ? message : OUTBOX_STORAGE_ERROR);
            }
            return;
          }
        }
        if (!drop(entry.clientId)) toast.error(OUTBOX_STORAGE_ERROR);
        else toast.success('Deletion undone.');
        changed.current();
      });
    } finally {
      setUndoingDelete(null);
    }
  }

  useEffect(() => {
    const refresh = () => {
      setUnassigned(unassignedWrites(groupId).length);
      const entries = ownerId ? queued(groupId, ownerId) : [];
      setFailed(entries.filter((entry) => entry.failure));
      queueChanged.current?.();
    };
    setSyncing(false);
    setPaused(undefined);
    refresh();
    void run();
    const onOnline = (): void => void run();
    window.addEventListener('online', onOnline);
    const unsubscribe = subscribe(refresh);
    return () => {
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
  }, [groupId, ownerId, run]);

  return {
    paused,
    syncing,
    retry: run,
    unassigned,
    recover,
    failed,
    undoableDeletions,
    undoingDelete,
    undoDelete,
    reviewPayment,
    retryFailed,
    discardFailed,
  };
}
