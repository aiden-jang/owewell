import { useEffect, useState } from 'react';
import { lastAccount } from '../lib/lastAccount';
import {
  isDelete,
  OUTBOX_STORAGE_ERROR,
  queueDeleteUndo,
  queued,
  subscribe,
  withOutboxLock,
  type QueuedDelete,
} from '../lib/outbox';
import { PendingDeletionList } from './PendingDeletionList';
import { useToast } from './Toast';

export function OfflineDeleteRecovery() {
  const toast = useToast();
  const [ownerId] = useState(lastAccount);
  const [entries, setEntries] = useState<QueuedDelete[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    const refresh = () =>
      setEntries(
        queued(undefined, ownerId)
          .filter(isDelete)
          .filter((entry) => !entry.failure),
      );
    refresh();
    return subscribe(refresh);
  }, [ownerId]);
  if (!ownerId || !entries.length) return null;

  async function undo(entry: QueuedDelete): Promise<void> {
    if (!ownerId || entry.ownerId !== ownerId || busy) return;
    setBusy(entry.clientId);
    try {
      await withOutboxLock(ownerId, async () => {
        if (queueDeleteUndo(entry))
          toast.success('Undo is saved on this device and will sync when you reconnect.');
        else toast.error(OUTBOX_STORAGE_ERROR);
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Offline recovery"
      className="mt-4 rounded-2xl border border-dashed border-line-strong px-3 py-2 text-sm text-muted"
    >
      <p className="mb-2">You can undo a pending deletion from this device while sign-in is unavailable.</p>
      <PendingDeletionList entries={entries} undo={undo} busy={busy} />
    </section>
  );
}
