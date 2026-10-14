import { useEffect, useState } from 'react';
import { dollarsToCents } from '@owewell/shared';
import {
  clearQuickSplitDraft,
  readQuickSplitDraft,
  writeQuickSplitDraft,
  type DraftItem,
  type DraftPerson,
} from './quickSplitDraft';

type Person = DraftPerson;
type Item = DraftItem;

function newPerson(name = ''): Person {
  return { id: crypto.randomUUID(), name };
}

function newItem(): Item {
  return { id: crypto.randomUUID(), description: '', amount: '', method: 'EQUAL', values: {}, payerId: '' };
}

/** Editable bill state, on-device recovery, participant changes and generated tips. */
export function useQuickSplitDraft() {
  const [initialDraft] = useState(readQuickSplitDraft);
  const [people, setPeople] = useState<Person[]>(initialDraft?.people ?? [newPerson('You'), newPerson('')]);
  const [items, setItems] = useState<Item[]>(initialDraft?.items ?? [newItem()]);
  const [payerId, setPayerId] = useState<string>(initialDraft?.payerId ?? '');
  // Off by default: one payer for the whole bill. On: a per-item "paid by" for split tabs.
  const [splitPayers, setSplitPayers] = useState(initialDraft?.splitPayers ?? false);
  const [youId, setYouId] = useState<string>(initialDraft?.youId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [draftRestored, setDraftRestored] = useState(initialDraft !== null);

  // A bill can take a while to enter on a phone. Keep a short-lived, on-device working copy so a
  // refresh, browser eviction, or accidental back gesture does not erase the table's progress.
  useEffect(() => {
    const meaningful =
      people.length > 2 ||
      people.some((person, index) => person.name.trim() && !(index === 0 && person.name.trim() === 'You')) ||
      items.some((item) => item.description.trim() || item.amount.trim());
    if (!meaningful) {
      clearQuickSplitDraft();
      return;
    }
    const timer = window.setTimeout(
      () => writeQuickSplitDraft({ people, items, payerId, splitPayers, youId }),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [people, items, payerId, splitPayers, youId]);

  function startFresh(): void {
    clearQuickSplitDraft();
    setPeople([newPerson('You'), newPerson('')]);
    setItems([newItem()]);
    setPayerId('');
    setSplitPayers(false);
    setYouId('');
    setCustomTip('');
    setError(null);
    setDraftRestored(false);
  }

  function updatePerson(id: string, patch: Partial<Person>): void {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function addPerson(): void {
    setPeople((prev) => [...prev, newPerson('')]);
  }
  function removePerson(id: string): void {
    if (people.length <= 2) return;
    setPeople((prev) => prev.filter((p) => p.id !== id));
    // Drop any per-item payer pointing at the removed person so it can't linger as a dangling
    // reference (which would silently reassign that item's payment on save).
    setItems((prev) => prev.map((it) => (it.payerId === id ? { ...it, payerId: '' } : it)));
  }

  function updateItem(id: string, patch: Partial<Item>): void {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function updateItemValue(itemId: string, personId: string, value: string): void {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, values: { ...it.values, [personId]: value } } : it)),
    );
  }
  function addItem(): void {
    setItems((prev) => [...prev, newItem()]);
  }
  function addTip(percent: number): void {
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setError('Enter a tip percentage from 1 to 100.');
      return;
    }
    const tipItems: Item[] = [];
    for (const item of items) {
      if (item.generatedTip || /\btip\b/i.test(item.description) || !item.amount.trim()) continue;
      if (item.method === 'EXACT') {
        setError('Add the tip manually when an item uses exact dollar amounts.');
        return;
      }
      try {
        const amountCents = dollarsToCents(item.amount);
        if (amountCents <= 0) continue;
        tipItems.push({
          ...newItem(),
          description: `${item.description.trim() || 'Bill'} tip (${percent}%)`,
          amount: (Math.round((amountCents * percent) / 100) / 100).toFixed(2),
          // Each tip follows the item that created it, including custom shares and who paid. That
          // keeps a split-tab tip aligned with the food instead of silently making it equal.
          method: item.method,
          values: { ...item.values },
          payerId: item.payerId,
          generatedTip: percent,
        });
      } catch {
        // Invalid amounts are already called out by the item and save validation.
      }
    }
    if (tipItems.length === 0) {
      setError('Add an item amount before calculating a tip.');
      return;
    }
    setError(null);
    // A preset is a choice, not an additive action. Switching 18 → 20 replaces the generated tip
    // rows instead of quietly charging both percentages.
    setItems((current) => [...current.filter((item) => !item.generatedTip), ...tipItems]);
  }
  function clearGeneratedTip(): void {
    setItems((current) => current.filter((item) => !item.generatedTip));
    setCustomTip('');
  }
  function removeItem(id: string): void {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  }

  const activeTip = items.find((item) => item.generatedTip)?.generatedTip ?? null;
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
    startFresh,
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
