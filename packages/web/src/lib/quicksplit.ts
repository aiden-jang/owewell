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
  people: PendingPerson[];
  items: PendingItem[];
}

const KEY = 'owewell:pending-split';

export function preparePendingSplit(split: PendingSplit, previous: PendingSplit | null): PendingSplit {
  const same =
    previous?.ownerId === split.ownerId &&
    JSON.stringify([previous?.people, previous?.items]) === JSON.stringify([split.people, split.items]);
  return {
    ...split,
    clientId: split.clientId ?? (same ? previous?.clientId : undefined) ?? crypto.randomUUID(),
  };
}

export function stashPendingSplit(split: PendingSplit): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(split));
    return true;
  } catch {
    return false;
  }
}

export function loadPendingSplit(): PendingSplit | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSplit;
    // Guard against a stale pre-multi-item split lingering in localStorage.
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSplit(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export const quickSplitApi = {
  save: (split: PendingSplit): Promise<{ groupId: string }> =>
    api.post<{ groupId: string }>('/quick-splits', split, split.ownerId),
};
