import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { clearQuickSplitDraft, draftId, listQuickSplitDrafts } from '../lib/quickSplitDraft';
import {
  clearPendingSplit,
  listPendingSplits,
  pendingSplitsForDraft,
  preparePendingSplit,
  quickSplitApi,
  readPendingSplit,
  stashPendingSplit,
  splitSaveId,
  subscribeToPendingSplits,
  withPendingSplitLock,
  type SavedPendingSplit,
} from '../lib/quicksplit';
import { useAsyncScope } from '../lib/useAsyncScope';

export function usePendingSplits(ownerId: string | undefined, resumeId: string | null) {
  const navigate = useNavigate();
  const toast = useToast();
  const { captureScope } = useAsyncScope(ownerId);
  const [records, setRecords] = useState(listPendingSplits);
  const [savingId, setSavingId] = useState<string | null>(null);
  const saving = useRef(false);
  const refresh = () => setRecords(listPendingSplits());
  useEffect(() => subscribeToPendingSplits(() => setRecords(listPendingSplits())), []);

  const pending = records.filter(({ split }) => !split.ownerId || split.ownerId === ownerId);
  const resumed = pending.find(({ id }) => id === resumeId);
  const visible = resumed ? [resumed, ...pending.filter(({ id }) => id !== resumeId)] : pending;

  async function save(record: SavedPendingSplit): Promise<void> {
    if (!ownerId || saving.current) return;
    saving.current = true;
    setSavingId(record.id);
    const samePage = captureScope();
    const url = window.location.href;
    const current = () => samePage() && window.location.href === url;
    const send = async () => {
      if (!current()) return;
      const latest = readPendingSplit(record.id);
      if (!latest || (latest.split.ownerId && latest.split.ownerId !== ownerId)) return;
      if (JSON.stringify(latest.split) !== JSON.stringify(record.split)) return;
      const split = preparePendingSplit({ ...latest.split, ownerId }, latest.split);
      if (!split.draftId && split.draftRevision) {
        const draft = listQuickSplitDrafts().find((value) => draftId(value) === split.draftRevision);
        if (draft) split.draftId = await splitSaveId(draft, split);
      }
      if (!stashPendingSplit(split)) throw new Error('Couldn’t keep this save on your device. Try again.');
      if (record.id === 'legacy') clearPendingSplit(latest);
      const { groupId } = await quickSplitApi.save(split);
      clearPendingSplit({ id: split.clientId, split });
      if (split.draftRevision && !pendingSplitsForDraft(split.draftRevision).length) {
        clearQuickSplitDraft(split.draftRevision);
      }
      if (current()) navigate(`/groups/${groupId}`);
    };
    try {
      await withPendingSplitLock(
        record.id === 'legacy' ? (record.split.clientId ?? record.id) : record.id,
        send,
      );
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : 'Could not save that split.');
    } finally {
      saving.current = false;
      if (samePage()) {
        refresh();
        setSavingId(null);
      }
    }
  }

  function dismiss(record: SavedPendingSplit): void {
    if (saving.current) return;
    clearPendingSplit(record);
    refresh();
    if (record.id === resumeId) navigate('/', { replace: true });
  }

  return { visible, savingId, missingResume: !!resumeId && !resumed, save, dismiss };
}
