import type { SplitMethod } from '@owewell/shared';

interface Preference {
  method: SplitMethod;
  participants: string[];
}
const methods = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES'];
const key = (groupId: string) => `owewell:split-preference:${groupId}`;

/** Only the setup is remembered: amounts and per-person values always start fresh. */
export function readSplitPreference(groupId: string): Preference | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(groupId)) ?? 'null') as Preference | null;
    if (
      !value ||
      !methods.includes(value.method) ||
      !Array.isArray(value.participants) ||
      !value.participants.every((id) => typeof id === 'string')
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function writeSplitPreference(groupId: string, method: SplitMethod, participants: string[]): void {
  try {
    localStorage.setItem(key(groupId), JSON.stringify({ method, participants }));
  } catch {
    /* Saving an expense must still work when device storage is unavailable. */
  }
}
