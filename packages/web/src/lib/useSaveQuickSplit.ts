import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUICK_SPLIT_LIMITS } from '@owewell/core';
import { dollarsToCents } from '@owewell/shared';
import { useAuth } from '../auth/AuthContext';
import { useAsyncScope } from './useAsyncScope';
import { serverValue } from './splitValues';
import type { QuickSplitInput } from './quickSplitDraft';
import {
  clearPendingSplit,
  loadPendingSplit,
  preparePendingSplit,
  quickSplitApi,
  stashPendingSplit,
  type PendingSplit,
} from './quicksplit';

function splitPayload(draft: QuickSplitInput, payerId: string, youId: string): PendingSplit {
  const people = draft.people.filter((person) => person.name.trim());
  if (people.length < 2) throw new Error('Add at least two people.');
  if (people.length > QUICK_SPLIT_LIMITS.people) {
    throw new Error(`A split can include up to ${QUICK_SPLIT_LIMITS.people} people.`);
  }
  if (people.some((person) => person.name.trim().length > QUICK_SPLIT_LIMITS.name)) {
    throw new Error(`Keep each name to ${QUICK_SPLIT_LIMITS.name} characters or fewer.`);
  }
  const items = draft.items
    .filter((item) => item.amount.trim())
    .map((item, index) => {
      const amountCents = dollarsToCents(item.amount);
      if (amountCents <= 0) throw new Error(`Enter an amount greater than zero for item ${index + 1}.`);
      const description = item.description.trim() || 'Quick split';
      if (description.length > QUICK_SPLIT_LIMITS.description) {
        throw new Error(
          `Keep item ${index + 1}’s description to ${QUICK_SPLIT_LIMITS.description} characters or fewer.`,
        );
      }
      const payerIndex = draft.splitPayers ? people.findIndex((person) => person.id === item.payerId) : -1;
      return {
        description,
        amountCents,
        splitMethod: item.method,
        values: people.map((person) => serverValue(item.method, item.values[person.id] ?? '') ?? null),
        ...(payerIndex >= 0 ? { payerIndex } : {}),
      };
    });
  if (!items.length) throw new Error('Add at least one item with an amount.');
  if (items.length > QUICK_SPLIT_LIMITS.items) {
    throw new Error(`A split can include up to ${QUICK_SPLIT_LIMITS.items} items, including tips.`);
  }
  return {
    people: people.map((person) => ({
      name: person.name.trim(),
      isPayer: person.id === payerId,
      isYou: person.id === youId,
    })),
    items,
  };
}

export function useSaveQuickSplit(
  setError: (message: string | null) => void,
  persistDraft: (draft: QuickSplitInput) => string | null,
  finishDraft: (saved: string | null) => void,
) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { captureScope } = useAsyncScope(user?.id);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<PendingSplit | null>(null);

  async function save(draft: QuickSplitInput, payerId: string, youId: string): Promise<void> {
    if (inFlight.current) return;
    const current = captureScope();
    setError(null);
    try {
      const payload = splitPayload(draft, payerId, youId);
      if (user) payload.ownerId = user.id;
      const draftRevision = persistDraft(draft);
      if (draftRevision) payload.draftRevision = draftRevision;
      const pending = preparePendingSplit(payload, attempt.current ?? loadPendingSplit());
      attempt.current = pending;
      if (!user) {
        if (!draftRevision || !stashPendingSplit(pending)) {
          setError(
            'This browser couldn’t keep your bill through sign-in. Keep this page open and sign in from another tab, or copy the summary.',
          );
          return;
        }
        login(window.location.origin);
        return;
      }
      stashPendingSplit(pending);
      inFlight.current = true;
      setSaving(true);
      const { groupId } = await quickSplitApi.save(pending);
      if (loadPendingSplit()?.clientId === pending.clientId) clearPendingSplit();
      if (!current()) return;
      finishDraft(draftRevision);
      navigate(`/groups/${groupId}`);
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : 'Could not save the split.');
    } finally {
      inFlight.current = false;
      if (current()) setSaving(false);
    }
  }

  return { saving, save };
}
