import { useCallback, useEffect, useRef, useState } from 'react';
import { clearPendingSplit, pendingSplitsForDraft } from './quicksplit';
import {
  clearQuickSplitDraft,
  draftId,
  listQuickSplitDrafts,
  preferredQuickSplitDraft,
  selectQuickSplitDraft,
  subscribeToQuickSplitDrafts,
  writeQuickSplitDraft,
  type QuickSplitDraft,
  type QuickSplitInput,
} from './quickSplitDraft';

export function useQuickSplitRecovery(ownerId?: string) {
  const owner = useRef(ownerId);
  owner.current = ownerId;
  const [savedDrafts, setSavedDrafts] = useState(listQuickSplitDrafts);
  const [initialDraft] = useState(() => preferredQuickSplitDraft(savedDrafts));
  const revision = useRef(initialDraft ? draftId(initialDraft) : null);
  const observedDraft = useRef<QuickSplitInput | null>(null);
  const lastWrite = useRef<{ draft: QuickSplitInput; revision: string } | null>(null);

  const persistDraft = useCallback((draft: QuickSplitInput): string | null => {
    if (lastWrite.current?.draft === draft) return lastWrite.current.revision;
    const saved = writeQuickSplitDraft(draft, revision.current);
    if (saved) lastWrite.current = { draft, revision: saved };
    if (saved && saved !== revision.current) {
      revision.current = saved;
      selectQuickSplitDraft(saved);
      setSavedDrafts(listQuickSplitDrafts());
    }
    return saved;
  }, []);

  const loadDraft = useCallback((next: QuickSplitDraft | null): void => {
    observedDraft.current = null;
    lastWrite.current = null;
    revision.current = next ? draftId(next) : null;
    selectQuickSplitDraft(revision.current);
    setSavedDrafts(listQuickSplitDrafts());
  }, []);

  const finishDraft = useCallback((saved: string | null): void => {
    observedDraft.current = null;
    if (saved && !pendingSplitsForDraft(saved).length) clearQuickSplitDraft(saved);
  }, []);

  const discardDraft = useCallback((): void => {
    if (revision.current) {
      for (const record of pendingSplitsForDraft(revision.current)) {
        if (!record.split.ownerId || record.split.ownerId === owner.current) clearPendingSplit(record);
      }
    }
    finishDraft(revision.current);
    loadDraft(null);
  }, [finishDraft, loadDraft]);

  useEffect(() => subscribeToQuickSplitDrafts(() => setSavedDrafts(listQuickSplitDrafts())), []);

  return {
    initialDraft,
    observedDraft,
    otherDrafts: savedDrafts.filter((draft) => draftId(draft) !== revision.current),
    persistDraft,
    loadDraft,
    discardDraft,
    finishDraft,
  };
}
