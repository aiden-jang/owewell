import { useCallback, useEffect, useRef } from 'react';
import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import { expensesApi } from './expenses';
import { settlementsApi } from './settlements';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { flush, isAlreadyDone, subscribe, type QueuedEdit, type QueuedWrite } from './outbox';

// Dashboard sync covers all groups; a group screen refreshes only its own ledger.

/** Send one queued write. The four kinds differ in exactly the ways the outbox comments describe. */
function sendQueuedWrite(entry: QueuedWrite): Promise<unknown> {
  switch (entry.kind) {
    case 'settlement':
      return settlementsApi.record(entry.groupId, entry.payload);
    case 'edit':
      return expensesApi.update(entry.groupId, entry.expenseId, entry.payload as CreateExpensePayload);
    case 'edit-itemized':
      return expensesApi.updateItemized(
        entry.groupId,
        entry.expenseId,
        entry.payload as CreateItemizedPayload,
      );
    case 'delete':
      // A queued delete finding nothing to delete got what it wanted, so it leaves the queue rather
      // than being reported as a failure the person has to do something about.
      return expensesApi.remove(entry.groupId, entry.expenseId).catch((err: unknown) => {
        if (!isAlreadyDone(err)) throw err;
      });
    case 'itemized':
      return expensesApi.createItemized(entry.groupId, entry.payload as CreateItemizedPayload);
    default:
      return expensesApi.create(entry.groupId, entry.payload as CreateExpensePayload);
  }
}

export function useOutboxSync({
  groupId,
  onChanged,
  onQueueChanged,
}: {
  /** Limits the sync to one group. Omit to drain everything, which is what the dashboard does. */
  groupId?: string;
  /** Something reached the server, so whatever this screen shows is now stale. */
  onChanged: () => void;
  /** The queue itself moved, for screens that render what is still waiting. */
  onQueueChanged?: () => void;
}): void {
  const toast = useToast();
  const confirm = useConfirm();
  const flushing = useRef(false);
  // Held in refs so the callbacks can change every render without restarting the effect below.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;

  const applyMine = useCallback(
    async (entry: QueuedEdit): Promise<void> => {
      try {
        // Without expectedVersion, so it overwrites rather than conflicting with the very change it
        // was just told about.
        const { expectedVersion: _dropped, ...forced } = entry.payload as { expectedVersion?: number };
        if (entry.kind === 'edit-itemized') {
          await expensesApi.updateItemized(entry.groupId, entry.expenseId, forced as CreateItemizedPayload);
        } else {
          await expensesApi.update(entry.groupId, entry.expenseId, forced as CreateExpensePayload);
        }
        changed.current();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not apply your version.');
      }
    },
    [toast],
  );

  const run = useCallback(async (): Promise<void> => {
    // Serialize flushes so overlapping reconnect events do not replay the same entry concurrently.
    if (flushing.current) return;
    flushing.current = true;
    try {
      const { sent, rejected, conflicted } = await flush(sendQueuedWrite, groupId);
      queueChanged.current?.();

      if (sent > 0) {
        toast.success(sent === 1 ? 'Sent the change that was waiting.' : `Sent ${sent} waiting changes.`);
        changed.current();
      }
      for (const { entry, message } of rejected) {
        // Named, because it is gone from the queue and the person has to know which one to retype.
        toast.error(`"${entry.description}" could not be saved: ${message}`);
      }

      // Resolve queued edit conflicts in order; silently applying one could erase newer work.
      for (const entry of conflicted) {
        const keepMine = await confirm({
          title: `"${entry.description}" changed while you were offline`,
          body: 'Somebody else edited it after you did. Apply your version anyway, or drop yours and keep theirs?',
          confirmLabel: 'Apply mine',
          cancelLabel: 'Keep theirs',
        });
        if (keepMine) await applyMine(entry);
      }
    } finally {
      flushing.current = false;
    }
  }, [applyMine, confirm, groupId, toast]);

  useEffect(() => {
    void run();
    const onOnline = (): void => void run();
    window.addEventListener('online', onOnline);
    const unsubscribe = subscribe(() => queueChanged.current?.());
    return () => {
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
  }, [run]);
}
