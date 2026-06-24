import { api } from './api';
import type { SplitMethod } from './expenses';

export interface PendingParticipant {
  name: string;
  value?: number;
  isPayer: boolean;
  isYou: boolean;
}

export interface PendingSplit {
  description: string;
  amountCents: number;
  splitMethod: SplitMethod;
  participants: PendingParticipant[];
}

const KEY = 'owe-well:pending-split';

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
    return raw ? (JSON.parse(raw) as PendingSplit) : null;
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
