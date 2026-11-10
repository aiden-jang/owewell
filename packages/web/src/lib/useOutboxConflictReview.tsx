import { useCallback, useRef } from 'react';
import { formatMoney, participantLabels } from '@owewell/shared';
import { useConfirm } from '../components/Confirm';
import { ExpenseEditComparison } from '../components/ExpenseEditComparison';
import { expenseEditDifferences } from './expenseEditDifferences';
import { expensesApi } from './expenses';
import { groupsApi } from './groups';
import { isCurrentOutboxEntry, isDelete, subscribe, type QueuedDelete, type QueuedEdit } from './outbox';

type Decision =
  | { status: 'apply'; version: number }
  | { status: 'keep' | 'later' | 'stale' | 'already-applied' | 'missing' | 'unavailable' }
  | { status: 'load-failed'; error: unknown };

export function useOutboxConflictReview() {
  const confirm = useConfirm();
  const active = useRef<AbortController | null>(null);
  const cancelReview = useCallback(() => active.current?.abort(), []);

  const review = useCallback(
    async (
      entry: QueuedEdit | QueuedDelete,
      ownerId: string,
      current: () => boolean,
      changedAgain: boolean,
    ): Promise<Decision> => {
      const stillCurrent = () => current() && isCurrentOutboxEntry(entry);
      if (!stillCurrent()) return { status: 'stale' };
      const deleting = isDelete(entry);
      let expense;
      let details;
      try {
        expense = (await expensesApi.list(entry.groupId, ownerId)).find((row) => row.id === entry.expenseId);
        if (!stillCurrent()) return { status: 'stale' };
        if (!expense) return { status: 'missing' };
        if (!Number.isSafeInteger(expense.version)) return { status: 'unavailable' };
        const differences = deleting ? null : expenseEditDifferences(entry, expense);
        if (differences?.length === 0) return { status: 'already-applied' };
        if (differences) {
          const { members } = await groupsApi.get(entry.groupId, ownerId);
          if (!stillCurrent()) return { status: 'stale' };
          const names = participantLabels(members);
          details = (
            <ExpenseEditComparison
              rows={differences.map((field) => field((id) => names.get(id) ?? 'Former member'))}
            />
          );
        }
      } catch (error) {
        return stillCurrent() ? { status: 'load-failed', error } : { status: 'stale' };
      }

      const { version, description, amountCents } = expense;
      const saved = `“${description}” for ${formatMoney(amountCents)}`;
      const edited = `“${entry.description}” for ${formatMoney(entry.amountCents ?? amountCents)}`;
      const comparison =
        saved === edited && details
          ? `Both versions show ${saved}. Compare the changes below before choosing a version.`
          : `The ledger shows ${saved}. Your edit is ${edited}. Applying yours replaces the ledger entry, including its split details.`;
      const controller = new AbortController();
      active.current = controller;
      const unsubscribe = subscribe(() => {
        if (!stillCurrent()) controller.abort();
      });
      let dismissed = false;
      try {
        const apply = await confirm({
          title: changedAgain
            ? `“${entry.description}” changed again`
            : `“${entry.description}” changed while you were offline`,
          body: deleting
            ? `The ledger now shows ${saved}. Review this version before deleting it.`
            : comparison,
          details,
          confirmLabel: deleting ? 'Delete expense' : 'Apply mine',
          cancelLabel: deleting ? 'Keep expense' : 'Keep theirs',
          tone: deleting ? 'danger' : 'default',
          signal: controller.signal,
          onDismiss: () => {
            dismissed = true;
          },
        });
        if (controller.signal.aborted || !stillCurrent()) return { status: 'stale' };
        if (dismissed) return { status: 'later' };
        return apply ? { status: 'apply', version } : { status: 'keep' };
      } finally {
        unsubscribe();
        if (active.current === controller) active.current = null;
      }
    },
    [confirm],
  );

  return { review, cancelReview };
}
