import { formatMoney } from '@owewell/shared';
import { fullDay } from '../lib/relativeTime';
import type { QueuedDelete } from '../lib/outbox';

export function PendingDeletionList({
  entries,
  undo,
  busy,
  groupName,
}: {
  entries: QueuedDelete[];
  undo: (entry: QueuedDelete) => Promise<void>;
  busy: string | null;
  groupName?: (groupId: string) => string | undefined;
}) {
  if (!entries.length) return null;
  return (
    <ul aria-label="Pending deletions" className="w-full divide-y divide-line border-t border-line">
      {entries.map((entry) => {
        const group = entry.groupName ?? groupName?.(entry.groupId) ?? `Group ${entry.groupId.slice(-6)}`;
        const amount = entry.amountCents === undefined ? undefined : formatMoney(entry.amountCents);
        const date = entry.date ? fullDay(entry.date, {}) : undefined;
        const details = [group, amount, date].filter(Boolean).join(' · ');
        return (
          <li key={entry.clientId} className="flex flex-wrap items-center justify-between gap-x-3">
            <span className="min-w-0 py-1 [overflow-wrap:anywhere]">
              <span className="font-medium text-ink">{entry.description}</span> is waiting to be deleted.
              <span className="block text-xs">{details}</span>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void undo(entry)}
              className="tap inline-flex min-h-11 items-center font-medium text-accent underline underline-offset-4 hover:text-ink disabled:opacity-60"
              aria-label={`Undo deletion of ${entry.description} in ${group}${amount ? ` for ${amount}` : ''}${date ? ` on ${date}` : ''}`}
            >
              {busy === entry.clientId ? 'Undoing…' : 'Undo deletion'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
