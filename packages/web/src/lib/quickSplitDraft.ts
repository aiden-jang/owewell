import type { SplitMethod } from '@owewell/core';
import { pendingSplitsForDraft } from './quicksplit';

// Reject malformed storage as a whole; partial recovery could silently drop a participant.

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
  revision?: string;
  people: DraftPerson[];
  items: DraftItem[];
  payerId: string;
  splitPayers: boolean;
  youId: string;
  tipPercent?: number;
}

export type QuickSplitInput = Omit<QuickSplitDraft, 'version' | 'savedAt' | 'revision'>;

const KEY = 'owewell:quick-split-draft';
const PREFIX = `${KEY}:`;
const LEGACY = 'legacy';
/** A week. Long enough to cover a trip, short enough that a stale bill does not reappear. */
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const METHODS = new Set<SplitMethod>(['EQUAL', 'SHARES', 'PERCENT', 'EXACT']);

const isPerson = (p: unknown): p is DraftPerson =>
  !!p &&
  typeof (p as DraftPerson).id === 'string' &&
  (p as DraftPerson).id.length > 0 &&
  typeof (p as DraftPerson).name === 'string';

const isItem = (i: unknown): i is DraftItem => {
  const item = i as DraftItem;
  return (
    !!item &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.description === 'string' &&
    typeof item.amount === 'string' &&
    METHODS.has(item.method) &&
    typeof item.values === 'object' &&
    item.values !== null &&
    !Array.isArray(item.values) &&
    Object.values(item.values).every((value) => typeof value === 'string') &&
    typeof item.payerId === 'string' &&
    (item.generatedTip === undefined || typeof item.generatedTip === 'number')
  );
};

function readDraft(key: string, now: number): QuickSplitDraft | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<QuickSplitDraft> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      Math.abs(now - parsed.savedAt) > MAX_AGE ||
      !Array.isArray(parsed.people) ||
      !Array.isArray(parsed.items)
    )
      return null;

    const { people, items } = parsed;
    if (people.length < 2 || items.length < 1 || !people.every(isPerson) || !items.every(isItem)) return null;
    if (
      new Set(people.map((p) => p.id)).size !== people.length ||
      new Set(items.map((i) => i.id)).size !== items.length
    )
      return null;

    return {
      version: 1,
      savedAt: parsed.savedAt,
      ...(typeof parsed.revision === 'string' ? { revision: parsed.revision } : {}),
      people,
      items,
      payerId: typeof parsed.payerId === 'string' ? parsed.payerId : '',
      splitPayers: parsed.splitPayers === true,
      youId: typeof parsed.youId === 'string' ? parsed.youId : '',
      ...(typeof parsed.tipPercent === 'number' && parsed.tipPercent > 0 && parsed.tipPercent <= 100
        ? { tipPercent: parsed.tipPercent }
        : {}),
    };
  } catch {
    return null;
  }
}

function matchesDraft(latest: QuickSplitDraft, draft: QuickSplitInput): boolean {
  const { version: _version, savedAt: _time, revision: _revision, ...input } = latest;
  return JSON.stringify(input) === JSON.stringify(draft);
}

export function draftId(draft: QuickSplitDraft): string {
  return draft.revision ?? LEGACY;
}

export function listQuickSplitDrafts(now = Date.now()): QuickSplitDraft[] {
  try {
    return [KEY, ...Object.keys(localStorage).filter((key) => key.startsWith(PREFIX))]
      .map((key) => readDraft(key, now))
      .filter((draft): draft is QuickSplitDraft => draft !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function preferredQuickSplitDraft(drafts: QuickSplitDraft[]): QuickSplitDraft | null {
  try {
    const preferred = sessionStorage.getItem(KEY);
    if (preferred === '') return null;
    return drafts.find((draft) => draftId(draft) === preferred) ?? drafts[0] ?? null;
  } catch {
    return drafts[0] ?? null;
  }
}

export function selectQuickSplitDraft(revision: string | null): void {
  try {
    sessionStorage.setItem(KEY, revision ?? '');
  } catch {
    // The on-device drafts are still available to select manually.
  }
}

export function subscribeToQuickSplitDrafts(refresh: () => void): () => void {
  const onStorage = ({ key }: StorageEvent) => {
    if (key === null || key === KEY || key.startsWith(PREFIX)) refresh();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export function writeQuickSplitDraft(draft: QuickSplitInput, parent: string | null): string | null {
  const now = Date.now();
  const previous = parent && (readDraft(`${PREFIX}${parent}`, now) ?? readDraft(KEY, now));
  if (previous && previous.revision === parent && matchesDraft(previous, draft)) return parent;
  try {
    const revision = crypto.randomUUID();
    // Separate keys let simultaneous edits survive even when both tabs started from the same revision.
    localStorage.setItem(
      `${PREFIX}${revision}`,
      JSON.stringify({ version: 1, savedAt: now, revision, ...draft }),
    );
    if (parent && !pendingSplitsForDraft(parent).length) clearQuickSplitDraft(parent);
    return revision;
  } catch {
    return null;
  }
}

export function clearQuickSplitDraft(revision: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${revision}`);
    const legacy = readDraft(KEY, Date.now());
    if (legacy && draftId(legacy) === revision) localStorage.removeItem(KEY);
  } catch {
    // Storage may be blocked.
  }
}
