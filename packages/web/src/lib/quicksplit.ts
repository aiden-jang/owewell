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
  people: PendingPerson[];
  items: PendingItem[];
}

const KEY = 'owewell:pending-split';

export function stashPendingSplit(split: PendingSplit): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(split));
  } catch {
    // storage unavailable; saving-after-signup just won't be offered
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
    api.post<{ groupId: string }>('/quick-splits', split),
};
