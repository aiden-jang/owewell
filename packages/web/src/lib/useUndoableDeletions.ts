import { useEffect, useState } from 'react';
import { isDelete, queued, subscribe } from './outbox';
import { recentDeletions, type UndoableDeletion } from './recentDeletions';

export function useUndoableDeletions(ownerId?: string | null, groupId?: string) {
  const [entries, setEntries] = useState<UndoableDeletion[]>([]);
  useEffect(() => {
    if (!ownerId) return;
    let expiry: number | undefined;
    const refresh = () => {
      window.clearTimeout(expiry);
      const waiting = queued(groupId, ownerId);
      const waitingIds = new Set(waiting.map((entry) => entry.clientId));
      const synced = recentDeletions(ownerId, groupId).filter((entry) => !waitingIds.has(entry.clientId));
      setEntries([...waiting.filter(isDelete).filter((entry) => !entry.failure), ...synced]);
      if (synced.length) {
        const next = Math.min(...synced.map((entry) => entry.undoUntil));
        expiry = window.setTimeout(refresh, Math.max(1, next - Date.now()));
      }
    };
    refresh();
    const unsubscribe = subscribe(refresh);
    return () => {
      window.clearTimeout(expiry);
      unsubscribe();
    };
  }, [groupId, ownerId]);
  return ownerId
    ? entries.filter((entry) => entry.ownerId === ownerId && (!groupId || entry.groupId === groupId))
    : [];
}
