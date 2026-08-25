import { useCallback, useEffect, useRef } from 'react';
import type { CreateExpensePayload, CreateItemizedPayload } from '@owewell/core';
import { expensesApi } from './expenses';
import { settlementsApi } from './settlements';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { flush, isAlreadyDone, subscribe, type QueuedEdit, type QueuedWrite } from './outbox';

/*
 * Draining the outbox, wherever you happen to be standing.
 *
 * This used to live in the group page, scoped to that group's id, which meant a write queued in one
 * group only went out when you next opened that group. Add an expense to the Big Sur tab on a train,
 * spend the week in the flat tab, and it sat in localStorage the whole time while the dashboard
 * quietly showed balances that did not include it.
 *
 * So the group page syncs its own group (it has the ledger on screen to refresh) and the dashboard
 * syncs everything (it is the screen you land on). One hook, because the interesting parts — one
 * flush at a time, what a rejection says, what a conflict asks — should not be written twice.
 */

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
    /*
     * One flush at a time.
     *
     * A flaky connection fires `online` more than once, and mount plus a reconnect can overlap, so
     * two passes would take the same entry off the queue twice and post it twice. The server's
     * client ids mean that is not a duplicate expense — which is the whole reason they exist — but a
     * wasted round trip and two identical toasts are still wrong.
     */
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

      /*
       * A conflict is a question, not an error.
       *
       * The row changed while this edit sat in the queue, so applying it silently would erase
       * whatever happened in between. Asked one at a time and in order, because answering "keep
       * mine" on the first can be what makes the second one make sense.
       */
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
