import type { SplitMethod } from '@owewell/core';

/*
 * The unsaved split, kept on this device.
 *
 * Quick split has no account behind it, so a closed tab is the only place the work can go. This is
 * the whole persistence layer: what a draft is, how long one lives, and what it takes to trust one
 * off disk. Lifted out of QuickSplitPage, which was a thousand lines with this buried at the top.
 *
 * Validation is strict on purpose. The value comes from localStorage, which anything on the origin
 * can write and an older build of this app definitely did: every field is checked rather than cast,
 * and anything that fails is treated as no draft at all. A half-restored split that silently drops
 * one person is worse than starting over.
 */

export interface DraftPerson {
  id: string;
  name: string;
}

export interface DraftItem {
  id: string;
  description: string;
  amount: string;
  /** Per-person raw value inputs (shares / percent / exact), keyed by person id. */
  values: Record<string, string>;
  method: SplitMethod;
  /** Person id of who paid for this item. Empty → the default payer. */
  payerId: string;
  /** Present only on tip rows created by a preset, so choosing another preset can replace them. */
  generatedTip?: number;
}

export interface QuickSplitDraft {
  version: 1;
  savedAt: number;
  people: DraftPerson[];
  items: DraftItem[];
  payerId: string;
  splitPayers: boolean;
  youId: string;
}

const KEY = 'owewell:quick-split-draft';
/** A week. Long enough to cover a trip, short enough that a stale bill does not reappear. */
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const METHODS = new Set<SplitMethod>(['EQUAL', 'SHARES', 'PERCENT', 'EXACT']);

const isPerson = (p: unknown): p is DraftPerson =>
  !!p && typeof (p as DraftPerson).id === 'string' && typeof (p as DraftPerson).name === 'string';

const isItem = (i: unknown): i is DraftItem => {
  const item = i as DraftItem;
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.description === 'string' &&
    typeof item.amount === 'string' &&
    METHODS.has(item.method) &&
    typeof item.values === 'object' &&
    item.values !== null &&
    Object.values(item.values).every((value) => typeof value === 'string') &&
    typeof item.payerId === 'string' &&
    (item.generatedTip === undefined || typeof item.generatedTip === 'number')
  );
};

/** The stored draft, or null if there isn't one worth restoring. */
export function readQuickSplitDraft(now = Date.now()): QuickSplitDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<QuickSplitDraft> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > MAX_AGE ||
      !Array.isArray(parsed.people) ||
      !Array.isArray(parsed.items)
    )
      return null;

    const people = parsed.people.filter(isPerson);
    const items = parsed.items.filter(isItem);
    // Fewer than two people or no items is not a split anybody was in the middle of.
    if (people.length < 2 || items.length < 1) return null;

    return {
      version: 1,
      savedAt: parsed.savedAt,
      people,
      items,
      payerId: typeof parsed.payerId === 'string' ? parsed.payerId : '',
      splitPayers: parsed.splitPayers === true,
      youId: typeof parsed.youId === 'string' ? parsed.youId : '',
    };
  } catch {
    return null;
  }
}

/** Storage failures are swallowed everywhere here: a draft is a convenience, never a blocker. */
export function writeQuickSplitDraft(draft: Omit<QuickSplitDraft, 'version' | 'savedAt'>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), ...draft }));
  } catch {
    // Private browsing, or a storage policy. The form carries on.
  }
}

export function clearQuickSplitDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
