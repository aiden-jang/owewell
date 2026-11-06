import { api } from './api';
import type { SplitMethod } from './expenses';

export interface PendingPerson {
  name: string;
  isPayer: boolean;
  isYou: boolean;
}

export interface PendingItem {
  description: string;
  amountCents: number;
  splitMethod: SplitMethod;
  /** Per-person values aligned to the `people` array order; null for EQUAL / no value. */
  values?: (number | null)[];
  /** Index into the `people` array of who paid for this item. Omit to use the default payer. */
  payerIndex?: number;
}

/** A quick split is now a set of shared people plus one or more expenses (items). */
export interface PendingSplit {
  clientId?: string;
  ownerId?: string;
  draftRevision?: string;
  people: PendingPerson[];
  items: PendingItem[];
}

const KEY = 'owewell:pending-split';
const PREFIX = `${KEY}:`;

export interface SavedPendingSplit {
  id: string;
  split: PendingSplit;
}

export function preparePendingSplit(
  split: PendingSplit,
  previous?: PendingSplit,
): PendingSplit & { clientId: string } {
  const same =
    previous &&
    (!previous.ownerId || previous.ownerId === split.ownerId) &&
    JSON.stringify([previous?.people, previous?.items]) === JSON.stringify([split.people, split.items]);
  return {
    ...split,
    clientId: split.clientId ?? (same ? previous?.clientId : undefined) ?? crypto.randomUUID(),
  };
}

export function stashPendingSplit(split: PendingSplit & { clientId: string }): boolean {
  try {
    localStorage.setItem(`${PREFIX}${split.clientId}`, JSON.stringify(split));
    return true;
  } catch {
    return false;
  }
}

export function readPendingSplit(id: string): SavedPendingSplit | null {
  try {
    const raw = localStorage.getItem(id === 'legacy' ? KEY : `${PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSplit;
    // Guard against a stale pre-multi-item split lingering in localStorage.
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.items)) return null;
    return { id, split: parsed };
  } catch {
    return null;
  }
}

export function listPendingSplits(): SavedPendingSplit[] {
  try {
    return [
      'legacy',
      ...Object.keys(localStorage)
        .filter((key) => key.startsWith(PREFIX))
        .map((key) => key.slice(PREFIX.length)),
    ]
      .map(readPendingSplit)
      .filter((record): record is SavedPendingSplit => record !== null);
  } catch {
    return [];
  }
}

export function clearPendingSplit(record: SavedPendingSplit): void {
  if (JSON.stringify(readPendingSplit(record.id)?.split) !== JSON.stringify(record.split)) return;
  try {
    localStorage.removeItem(record.id === 'legacy' ? KEY : `${PREFIX}${record.id}`);
  } catch {
    // ignore
  }
}

export function pendingSplitsForDraft(revision: string): SavedPendingSplit[] {
  return listPendingSplits().filter(({ split }) => split.draftRevision === revision);
}

export async function withPendingSplitLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request(`owewell:save-split:${id}`, action) : action();
}

export function subscribeToPendingSplits(refresh: () => void): () => void {
  const onStorage = ({ key }: StorageEvent) => {
    if (key === null || key === KEY || key.startsWith(PREFIX)) refresh();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export const quickSplitApi = {
  save: ({ draftRevision: _revision, ...split }: PendingSplit): Promise<{ groupId: string }> =>
    api.post<{ groupId: string }>('/quick-splits', split, split.ownerId),
};
