import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import { expensesApi } from './expenses';
import { settlementsApi } from './settlements';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { useAsyncScope } from './useAsyncScope';
import {
  adoptWrites,
  drop,
  flush,
  isOffline,
  OUTBOX_STORAGE_ERROR,
  pauseFor,
  queued,
  unassignedWrites,
  isAlreadyDone,
  subscribe,
  type FlushResult,
  type QueuedEdit,
  type QueuedWrite,
} from './outbox';

// Dashboard sync covers all groups; a group screen refreshes only its own ledger.

/** Send one queued write. The four kinds differ in exactly the ways the outbox comments describe. */
function sendQueuedWrite(entry: QueuedWrite, ownerId: string): Promise<unknown> {
  switch (entry.kind) {
    case 'settlement':
      return settlementsApi.record(entry.groupId, entry.payload, ownerId);
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
      return expensesApi.remove(entry.groupId, entry.expenseId, ownerId).catch((err: unknown) => {
        if (!isAlreadyDone(err)) throw err;
      });
    case 'itemized':
      return expensesApi.createItemized(entry.groupId, entry.payload as CreateItemizedPayload, ownerId);
    default:
      return expensesApi.create(entry.groupId, entry.payload as CreateExpensePayload, ownerId);
  }
}

export interface OutboxSync {
  paused: FlushResult['paused'];
  syncing: boolean;
  unassigned: number;
  recover: () => Promise<void>;
  retry: () => Promise<void>;
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
  const [syncing, setSyncing] = useState(false);
  const [paused, setPaused] = useState<FlushResult['paused']>();
  // Held in refs so the callbacks can change every render without restarting the effect below.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;

  const run = useCallback(async (): Promise<void> => {
    if (!ownerId || flushing.current?.()) return;
    const current = captureScope();
    flushing.current = current;
    setSyncing(true);
    const send = (entry: QueuedWrite) => sendQueuedWrite(entry, ownerId);
    const drain = async () => {
      let result: FlushResult;
      do {
        result = await flush(send, groupId, ownerId);
        if (!current()) return;
        setPaused(result.paused);
        queueChanged.current?.();

        if (result.sent > 0) {
          toast.success(
            result.sent === 1 ? 'Sent the change that was waiting.' : `Sent ${result.sent} waiting changes.`,
          );
          changed.current();
        }
        for (const { entry, message } of result.rejected) {
          toast.error(`“${entry.description}” could not be saved: ${message}`);
        }
        const entry = result.conflicted[0];
        if (!entry) break;
        const keepMine = await confirm({
          title: `“${entry.description}” changed while you were offline`,
          body: 'Apply your version, or keep the version currently in the ledger?',
          confirmLabel: 'Apply mine',
          cancelLabel: 'Keep theirs',
        });
        if (!current()) return;
        if (!queued(groupId, ownerId).some((row) => row.clientId === entry.clientId)) continue;
        if (keepMine) {
          try {
            const { expectedVersion: _version, ...payload } = entry.payload;
            await send({ ...entry, payload } as QueuedEdit);
            if (current()) changed.current();
          } catch (error) {
            if (current()) {
              setPaused(pauseFor(error));
              toast.error(
                isOffline(error)
                  ? 'Still offline. Your edit is waiting on this device.'
                  : 'Could not apply your version. Your edit is still waiting.',
              );
            }
            return;
          }
        }
        if (!drop(entry.clientId)) {
          if (current()) setPaused('storage');
          return;
        }
      } while (current() && result.conflicted.length > 0);
    };
    try {
      if (navigator.locks) {
        await navigator.locks.request(`owewell:sync:${ownerId}`, async () => {
          if (current()) await drain();
        });
      } else {
        await drain();
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

  useEffect(() => {
    const refresh = () => {
      setUnassigned(unassignedWrites(groupId).length);
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
  }, [groupId, run]);

  return { paused, syncing, retry: run, unassigned, recover };
}
