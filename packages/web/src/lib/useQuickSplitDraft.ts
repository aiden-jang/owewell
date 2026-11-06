import { useEffect, useMemo, useRef, useState } from 'react';
import { dollarsToCents } from '@owewell/shared';
import { QUICK_SPLIT_LIMITS } from '@owewell/core';
import type { DraftItem, DraftPerson, QuickSplitDraft, QuickSplitInput } from './quickSplitDraft';
import { useQuickSplitRecovery } from './useQuickSplitRecovery';

type Person = DraftPerson;
type Item = DraftItem;

function newPerson(name = ''): Person {
  return { id: crypto.randomUUID(), name };
}

function newItem(): Item {
  return { id: crypto.randomUUID(), description: '', amount: '', method: 'EQUAL', values: {}, payerId: '' };
}

function buildTips(items: Item[], percent: number): Item[] {
  return items.flatMap((item) => {
    if (
      item.generatedTip ||
      /\btip\b/i.test(item.description) ||
      !item.amount.trim() ||
      item.method === 'EXACT'
    )
      return [];
    try {
      const cents = Math.round((dollarsToCents(item.amount) * percent) / 100);
      if (cents <= 0) return [];
      const suffix = ` tip (${percent}%)`;
      return [
        {
          ...item,
          id: `${item.id}:tip`,
          description:
            (item.description.trim() || 'Bill').slice(0, QUICK_SPLIT_LIMITS.description - suffix.length) +
            suffix,
          amount: (cents / 100).toFixed(2),
          generatedTip: percent,
        },
      ];
    } catch {
      return [];
    }
  });
}

function updateTips(items: Item[], percent?: number | null): Item[] {
  if (!percent) return items;
  return [...items.filter((item) => !item.generatedTip), ...buildTips(items, percent)];
}

/** Editable bill state, on-device recovery, participant changes and generated tips. */
export function useQuickSplitDraft() {
  const { initialDraft, observedDraft, otherDrafts, persistDraft, loadDraft, discardDraft, finishDraft } =
    useQuickSplitRecovery();
  const [people, setPeople] = useState<Person[]>(initialDraft?.people ?? [newPerson('You'), newPerson('')]);
  const initialTip =
    initialDraft?.tipPercent ?? initialDraft?.items.find((item) => item.generatedTip)?.generatedTip ?? null;
  const [items, setItems] = useState<Item[]>(() => initialDraft?.items ?? [newItem()]);
  const [activeTip, setActiveTip] = useState(initialTip);
  const [payerId, setPayerId] = useState<string>(initialDraft?.payerId ?? '');
  // Off by default: one payer for the whole bill. On: a per-item "paid by" for split tabs.
  const [splitPayers, setSplitPayers] = useState(initialDraft?.splitPayers ?? false);
  const [youId, setYouId] = useState<string>(initialDraft?.youId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [draftRestored, setDraftRestored] = useState(initialDraft !== null);
  const flushDraft = useRef<(() => boolean) | null>(null);
  const draft = useMemo<QuickSplitInput>(
    () => ({ people, items, payerId, splitPayers, youId, ...(activeTip ? { tipPercent: activeTip } : {}) }),
    [people, items, payerId, splitPayers, youId, activeTip],
  );

  // A bill can take a while to enter on a phone. Keep a short-lived, on-device working copy so a
  // refresh, browser eviction, or accidental back gesture does not erase the table's progress.
  useEffect(() => {
    const previous = observedDraft.current;
    observedDraft.current = draft;
    flushDraft.current = null;
    if (!previous || previous === draft) return;
    const meaningful =
      draft.people.length > 2 ||
      draft.people.some(
        (person, index) => person.name.trim() && !(index === 0 && person.name.trim() === 'You'),
      ) ||
      draft.items.some((item) => item.description.trim() || item.amount.trim());
    if (!meaningful) {
      discardDraft();
      observedDraft.current = draft;
      return;
    }
    let pending = true;
    const persist = () => {
      if (pending && observedDraft.current === draft && persistDraft(draft)) pending = false;
      return !pending;
    };
    flushDraft.current = persist;
    const timer = window.setTimeout(persist, 350);
    return () => window.clearTimeout(timer);
  }, [draft, discardDraft, observedDraft, persistDraft]);

  useEffect(() => {
    const persist = () => flushDraft.current?.();
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('pagehide', persist);
      persist();
    };
  }, []);

  function restoreDraft(next: QuickSplitDraft): void {
    if (flushDraft.current?.() === false) {
      setError('This browser couldn’t keep your current bill. Copy the summary before switching drafts.');
      return;
    }
    loadDraft(next);
    setPeople(next.people);
    setItems(next.items);
    setPayerId(next.payerId);
    setSplitPayers(next.splitPayers);
    setYouId(next.youId);
    setCustomTip('');
    setActiveTip(next.tipPercent ?? next.items.find((item) => item.generatedTip)?.generatedTip ?? null);
    setError(null);
    setDraftRestored(true);
  }

  function startFresh(): void {
    discardDraft();
    setPeople([newPerson('You'), newPerson('')]);
    setItems([newItem()]);
    setPayerId('');
    setSplitPayers(false);
    setYouId('');
    setCustomTip('');
    setActiveTip(null);
    setError(null);
    setDraftRestored(false);
  }

  function updatePerson(id: string, patch: Partial<Person>): void {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (patch.name !== undefined && !patch.name.trim()) {
      if (payerId === id) setPayerId('');
      if (youId === id) setYouId('');
      setItems((prev) =>
        updateTips(
          prev.map((it) => (it.payerId === id ? { ...it, payerId: '' } : it)),
          activeTip,
        ),
      );
    }
  }
  function addPerson(): void {
    setPeople((prev) => (prev.length < QUICK_SPLIT_LIMITS.people ? [...prev, newPerson('')] : prev));
  }
  function removePerson(id: string): void {
    if (people.length <= 2) return;
    setPeople((prev) => prev.filter((p) => p.id !== id));
    // Drop any per-item payer pointing at the removed person so it can't linger as a dangling
    // reference (which would silently reassign that item's payment on save).
    setItems((prev) =>
      updateTips(
        prev.map((it) => (it.payerId === id ? { ...it, payerId: '' } : it)),
        activeTip,
      ),
    );
    if (payerId === id) setPayerId('');
    if (youId === id) setYouId('');
  }

  function updateItem(id: string, patch: Partial<Item>): void {
    if (patch.method === 'EXACT' && items.some((item) => item.generatedTip && item.id === `${id}:tip`)) {
      setError('Enter the tip for this item manually when using exact amounts.');
    }
    setItems((prev) =>
      updateTips(
        prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        activeTip,
      ),
    );
  }
  function updateItemValue(itemId: string, personId: string, value: string): void {
    setItems((prev) =>
      updateTips(
        prev.map((it) => (it.id === itemId ? { ...it, values: { ...it.values, [personId]: value } } : it)),
        activeTip,
      ),
    );
  }
  function addItem(): void {
    setItems((prev) =>
      prev.length < QUICK_SPLIT_LIMITS.items ? updateTips([...prev, newItem()], activeTip) : prev,
    );
  }
  function addTip(percent: number): void {
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setError('Enter a tip percentage from 1 to 100.');
      return;
    }
    if (items.some((item) => !item.generatedTip && item.amount.trim() && item.method === 'EXACT')) {
      setError('Add the tip manually when an item uses exact dollar amounts.');
      return;
    }
    const tipItems = buildTips(items, percent);
    if (tipItems.length === 0) {
      setError('Add an item amount before calculating a tip.');
      return;
    }
    setError(null);
    // A preset is a choice, not an additive action. Switching 18 → 20 replaces the generated tip
    // rows instead of quietly charging both percentages.
    setItems((current) => [...current.filter((item) => !item.generatedTip), ...tipItems]);
    setActiveTip(percent);
  }
  function clearGeneratedTip(): void {
    setItems((current) => current.filter((item) => !item.generatedTip));
    setActiveTip(null);
    setCustomTip('');
  }
  function removeItem(id: string): void {
    setItems((prev) =>
      prev.filter((item) => !item.generatedTip).length <= 1
        ? prev
        : updateTips(
            prev.filter((it) => it.id !== id),
            activeTip,
          ),
    );
  }

  const generatedTipTotal = items.reduce((sum, item) => {
    if (!item.generatedTip) return sum;
    try {
      return sum + dollarsToCents(item.amount);
    } catch {
      return sum;
    }
  }, 0);
  const canTryExample =
    !draftRestored &&
    people.length === 2 &&
    people[0]?.name === 'You' &&
    !people[1]?.name &&
    items.every((item) => !item.amount && !item.description);
  function tryExample(): void {
    const payer = newPerson('You');
    const guests = [payer, newPerson('Sam'), newPerson('Jo')];
    setPeople(guests);
    setPayerId(payer.id);
    setYouId(payer.id);
    setItems([{ ...newItem(), description: 'Dinner (example)', amount: '48' }]);
    setError(null);
  }

  return {
    draft,
    people,
    items,
    payerId,
    setPayerId,
    splitPayers,
    setSplitPayers,
    youId,
    setYouId,
    error,
    setError,
    customTip,
    setCustomTip,
    draftRestored,
    otherDrafts,
    restoreDraft,
    persistDraft,
    startFresh,
    finishDraft,
    updatePerson,
    addPerson,
    removePerson,
    updateItem,
    updateItemValue,
    addItem,
    addTip,
    clearGeneratedTip,
    removeItem,
    activeTip,
    generatedTipTotal,
    canTryExample,
    tryExample,
  };
}
