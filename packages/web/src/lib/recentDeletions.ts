import type { QueuedDelete } from './outbox';

export type UndoableDeletion = QueuedDelete & { undoUntil?: number };
type SyncedDeletion = QueuedDelete & { undoUntil: number };
export const recentDeletionsPrefix = 'owewell:recent-deletions:v1:';

function read(ownerId: string): SyncedDeletion[] {
  const entries: unknown = JSON.parse(localStorage.getItem(recentDeletionsPrefix + ownerId) ?? '[]');
  return Array.isArray(entries) ? entries.filter((entry) => entry?.undoUntil > Date.now()) : [];
}

export function recentDeletions(ownerId: string, groupId?: string): SyncedDeletion[] {
  try {
    return read(ownerId).filter(
      (entry) => entry.ownerId === ownerId && (!groupId || entry.groupId === groupId),
    );
  } catch {
    return [];
  }
}

export function rememberSyncedDeletion(entry: QueuedDelete): boolean {
  if (!entry.ownerId) return true;
  try {
    const entries = read(entry.ownerId).filter((other) => other.clientId !== entry.clientId);
    const undoUntil = Date.now() + 5 * 60_000;
    localStorage.setItem(
      recentDeletionsPrefix + entry.ownerId,
      JSON.stringify([...entries, { ...entry, undoUntil }]),
    );
    return true;
  } catch {
    return false;
  }
}

export function forgetSyncedDeletion(ownerId: string, clientId: string): void {
  try {
    const entries = read(ownerId).filter((entry) => entry.clientId !== clientId);
    localStorage.setItem(recentDeletionsPrefix + ownerId, JSON.stringify(entries));
  } catch {
    // A restore is already durable in the outbox.
  }
}
