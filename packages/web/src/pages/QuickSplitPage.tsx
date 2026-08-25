import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money, dollarsToCents, type SplitMethod, type Transfer } from '@owewell/shared';
import { normalizeAmountInput } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { PublicHeader } from '../components/PublicHeader';
import { serverValue } from '../lib/splitValues';
import { computeQuickSplit } from '../lib/quickSplitResult';
import {
  clearQuickSplitDraft,
  readQuickSplitDraft,
  writeQuickSplitDraft,
  type DraftItem,
  type DraftPerson,
} from '../lib/quickSplitDraft';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import {
  clearPendingSplit,
  quickSplitApi,
  stashPendingSplit,
  type PendingItem,
  type PendingSplit,
} from '../lib/quicksplit';
import { SPLIT_METHODS, splitMethodHint, splitMethodUnit } from '../lib/splitMethods';
import { useShareAction } from '../lib/useShareAction';

/*
 * The draft layer, the split-value parsing and the public header all moved out — see
 * lib/quickSplitDraft.ts, lib/splitValues.ts and components/PublicHeader.tsx. This file is the
 * landing page, the demo and the tool in one component, which is enough for one file to be.
 */
type Person = DraftPerson;
type Item = DraftItem;

function newPerson(name = ''): Person {
  return { id: crypto.randomUUID(), name };
}

function newItem(): Item {
  return { id: crypto.randomUUID(), description: '', amount: '', method: 'EQUAL', values: {}, payerId: '' };
}

/**
 * One dry line about the shape of the split, read off the numbers.
 *
 * Generated, not decorative: every branch is a fact the app already computed, so the line is only
 * ever true. That is the whole trick — "someone got the steak" lands because the split really is
 * lopsided, and a random quip in the same slot would be noise.
 *
 * Deliberately absent from the text you send to the group (see summaryText). The app can be funny
 * at your bill; a joke arriving in everyone else's chat reads as the sender being funny at them.
 *
 * Returns null far more often than not. A verdict on every ordinary split would stop being a
 * remark and become furniture.
 */
function splitVerdict(
  named: Person[],
  shares: Record<string, number>,
  transfers: Transfer[],
  payerId: string,
): string | null {
  if (named.length < 2 || transfers.length === 0) return null;
  const nameOf = (id: string): string => named.find((p) => p.id === id)?.name.trim() || 'Someone';
  const values = named.map((p) => shares[p.id] ?? 0);
  if (values.reduce((a, b) => a + b, 0) <= 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);

  // Ordered rarest first. An earlier version led with "one person paid for everything", which is
  // the default arrangement and therefore fired on nearly every bill — it shadowed both of the
  // observations below and stopped reading as a remark within about three splits.
  if (min === 0) {
    const free = named.find((p) => (shares[p.id] ?? 0) === 0);
    if (free) return `${free.name.trim()} owes nothing. Must be nice.`;
  }
  // Lopsided on purpose, not by a rounding cent: twice the smallest share and at least $5 apart.
  if (max >= min * 2 && max - min > 500) {
    const biggest = named.find((p) => (shares[p.id] ?? 0) === max);
    if (biggest) return `${biggest.name.trim()} got the steak.`;
  }
  // One person carrying a genuine crowd. Four is the threshold where it stops being a normal
  // dinner and starts being a favour.
  const owedTo = new Set(transfers.map((t) => t.toUserId));
  if (named.length >= 4 && owedTo.size === 1 && owedTo.has(payerId)) {
    return `${nameOf(payerId)} fronted for ${named.length - 1} people. A saint, allegedly.`;
  }
  return null;
}

export function QuickSplitPage(): ReactNode {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [initialDraft] = useState(readQuickSplitDraft);
  const [people, setPeople] = useState<Person[]>(initialDraft?.people ?? [newPerson('You'), newPerson('')]);
  const [items, setItems] = useState<Item[]>(initialDraft?.items ?? [newItem()]);
  const [payerId, setPayerId] = useState<string>(initialDraft?.payerId ?? '');
  // Off by default: one payer for the whole bill. On: a per-item "paid by" for split tabs.
  const [splitPayers, setSplitPayers] = useState(initialDraft?.splitPayers ?? false);
  const [youId, setYouId] = useState<string>(initialDraft?.youId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // An inline error rather than a toast: this page has no toast provider above it.
  const { status: shareStatus, share } = useShareAction(setError);
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

  /*
   * Everything the numbers say, worked out in one place.
   *
   * This was ninety lines of mutable accumulators inline in the render, and the only money math in
   * the app with no tests behind it. See lib/quickSplitResult.ts.
   */
  const { named, effectivePayerId, effectiveYouId, transfers, grandTotal, yourShareCents, sharesByPerson } =
    computeQuickSplit({ people, items, payerId, youId, splitPayers });

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

  // Live running total for one item's non-equal split, so values that don't add
  // up are visible before saving. Mirrors the group expense form.
  function itemSplitHint(item: Item): { text: string; tone: string } | null {
    if (item.method === 'EQUAL') return null;
    const raws = named.map((p) => (item.values[p.id] ?? '').trim()).filter(Boolean);
    if (item.method === 'EXACT') {
      let sum = 0;
      let ok = true;
      for (const r of raws) {
        try {
          sum += dollarsToCents(r);
        } catch {
          ok = false;
        }
      }
      let target = 0;
      try {
        target = item.amount.trim() ? dollarsToCents(item.amount) : 0;
      } catch {
        target = 0;
      }
      const tone = !ok
        ? 'text-neg'
        : target > 0 && sum === target
          ? 'text-pos'
          : sum > target
            ? 'text-neg'
            : 'text-muted';
      return { text: `${Money.fromCents(sum).format()} of ${Money.fromCents(target).format()}`, tone };
    }
    if (item.method === 'PERCENT') {
      let sum = 0;
      let ok = true;
      for (const r of raws) {
        const n = Number(r);
        if (Number.isFinite(n)) sum += n;
        else ok = false;
      }
      const rounded = Math.round(sum * 100) / 100;
      const tone = !ok
        ? 'text-neg'
        : rounded === 100
          ? 'text-pos'
          : rounded > 100
            ? 'text-neg'
            : 'text-muted';
      return { text: `${rounded}% of 100%`, tone };
    }
    let sum = 0;
    for (const r of raws) {
      const n = Number(r);
      if (Number.isFinite(n)) sum += n;
    }
    return { text: `${sum} share${sum === 1 ? '' : 's'} total`, tone: 'text-muted' };
  }

  const nameById = (id: string): string => people.find((p) => p.id === id)?.name.trim() || 'Someone';
  const activeTip = items.find((item) => item.generatedTip)?.generatedTip ?? null;
  const generatedTipTotal = items.reduce((sum, item) => {
    if (!item.generatedTip) return sum;
    try {
      return sum + dollarsToCents(item.amount);
    } catch {
      return sum;
    }
  }, 0);
  // Surface the one next step that applies to the person holding the phone. The full transfer list
  // still matters for the group chat, but making everyone scan it to learn their own move is where
  // a simple split starts feeling like admin.
  const yourPayment = transfers?.find((transfer) => transfer.fromUserId === effectiveYouId) ?? null;
  const yourReceive = transfers?.find((transfer) => transfer.toUserId === effectiveYouId) ?? null;

  const verdict =
    sharesByPerson && transfers ? splitVerdict(named, sharesByPerson, transfers, effectivePayerId) : null;

  /**
   * The result as plain text, for pasting into the group chat.
   *
   * Deliberately joke-free, unlike the button that produces it. This lands in a conversation with
   * other people in it, and a bill that arrives with a punchline attached reads as the sender being
   * funny at everyone else's expense. The numbers are the whole payload.
   */
  function summaryText(): string {
    const title = items.find((i) => i.description.trim())?.description.trim() ?? 'Split';
    const lines = [`${title} · ${Money.fromCents(grandTotal).format()}`, ''];
    for (const t of transfers ?? []) {
      lines.push(
        `${nameById(t.fromUserId)} owes ${nameById(t.toUserId)} ${Money.fromCents(t.amountCents).format()}`,
      );
    }
    if (transfers?.length === 0) lines.push('All settled up. Nobody owes anybody.');
    return lines.join('\n');
  }

  function shareSummary(): void {
    void share({
      title: 'owewell split',
      text: summaryText(),
      failureMessage: 'Couldn’t share the split. Try again in a moment.',
    });
  }

  async function onSave(): Promise<void> {
    setError(null);
    if (named.length < 2) {
      setError('Add at least two people.');
      return;
    }
    if (!named.some((p) => p.id === effectivePayerId)) {
      setError('Pick who paid.');
      return;
    }

    const builtItems: PendingItem[] = [];
    for (const item of items) {
      if (!item.amount.trim()) continue;
      let amountCents: number;
      try {
        amountCents = dollarsToCents(item.amount);
      } catch {
        setError('Enter a valid amount for each item.');
        return;
      }
      if (amountCents <= 0) {
        setError('Each item amount must be more than zero.');
        return;
      }
      let values: (number | null)[];
      try {
        values = named.map((p) => serverValue(item.method, item.values[p.id] ?? '') ?? null);
      } catch {
        setError('Check the per-person values on each item.');
        return;
      }
      // Only send per-item payers when the split-tabs toggle is on; otherwise the backend
      // falls back to the single default payer.
      const payerIndex = splitPayers
        ? named.findIndex((p) => p.id === (item.payerId || effectivePayerId))
        : -1;
      builtItems.push({
        description: item.description.trim() || 'Quick split',
        amountCents,
        splitMethod: item.method,
        values,
        ...(payerIndex >= 0 ? { payerIndex } : {}),
      });
    }
    if (builtItems.length === 0) {
      setError('Add at least one item with an amount.');
      return;
    }

    const pending: PendingSplit = {
      people: named.map((p) => ({
        name: p.name.trim(),
        isPayer: p.id === effectivePayerId,
        isYou: p.id === effectiveYouId,
      })),
      items: builtItems,
    };
    stashPendingSplit(pending);

    if (!user) {
      // Stash it, send them to sign up on the shared auth service, and land back on the dashboard,
      // which offers to save the pending split once they're signed in.
      clearQuickSplitDraft();
      signup(window.location.origin);
      return;
    }

    setSaving(true);
    try {
      const { groupId } = await quickSplitApi.save(pending);
      clearPendingSplit();
      clearQuickSplitDraft();
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the split.');
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <div className="flex-1">
      {user ? <AppHeader /> : <PublicHeader />}
      {/*
       * Two widths on purpose, which is the one place in the app that has them.
       *
       * Everything else is max-w-2xl end to end. Here the page is also a landing page, and a
       * headline plus a three-card row penned into 672px on a 1280px laptop reads as a phone
       * screenshot someone centred. The pitch and the feature row get the wider column; the tool
       * itself stays at 2xl, because it is a form and a form does not get better by getting wider.
       *
       * Signed in there is no marketing, so the page is just the form and stays narrow.
       */}
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto w-full animate-rise px-4 py-10 ${user ? 'max-w-2xl' : 'max-w-2xl lg:max-w-5xl'}`}
      >
        {/*
         * Pitch beside the tool once there is room for both.
         *
         * Stacked, the wider column gave the hero a left edge at 85px and the centred form one at
         * 190px — two starts, and a lot of empty right-hand side. Side by side, the pitch stays
         * visible while you use the thing it is pitching, which is the whole argument for a
         * no-signup demo being on the landing page at all. Below lg it stacks as before.
         */}
        <div
          className={
            user ? '' : 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-start lg:gap-12'
          }
        >
          {user ? (
            <>
              <h1 className="font-display text-4xl font-semibold tracking-tight">Split a bill</h1>
              <p className="mt-2 text-base text-muted">
                Somebody paid, everybody forgot. Add the group, drop in the damage, and find out who owes who.
                No account unless you get attached.
              </p>
            </>
          ) : (
            <section className="mb-9 lg:sticky lg:top-24 lg:mb-0">
              <p className="text-sm font-semibold text-accent">owewell</p>
              {/* No lg bump: beside the tool the pitch column is ~430px, and 60px type breaks
                "Keep the friends." across two lines. 48px needs 382px and holds. */}
              <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
                Split the bill.
                <br />
                Keep the friends.
              </h1>
              {/* Held to a measure rather than the column: 46 characters of 16px text is a line you
                read, and the wider column would otherwise stretch this to about 90. */}
              <p className="mt-3 max-w-[46ch] text-base text-muted">
                Who owes who, sorted in about ten seconds. Add people, punch in what got spent, and let the
                math do the awkward part.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {['No account needed', 'Works on your phone', 'Save it when you get attached'].map((t) => (
                  <span key={t} className="rounded-full border border-line bg-field px-3 py-1 text-muted">
                    {t}
                  </span>
                ))}
              </div>
              {/* On a laptop the tool is beside this, not below it, so "right here" points sideways. */}
              <p className="mt-6 text-sm font-medium text-muted lg:hidden">Try it right here, no sign-up:</p>
            </section>
          )}

          {/* The form, at form width, whatever the page around it is doing. */}
          <div className="mx-auto w-full max-w-2xl lg:mx-0">
            {draftRestored && (
              <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface2/60 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold text-ink">Your split is back.</span>{' '}
                  <span className="text-muted">We kept this draft on this device.</span>
                </span>
                <button
                  type="button"
                  onClick={startFresh}
                  className="shrink-0 font-medium text-muted transition hover:text-ink hover:underline"
                >
                  Start fresh
                </button>
              </div>
            )}

            {/* People — shared across every item */}
            <div className="surface mt-6 space-y-2 rounded-3xl p-5">
              <h2 className="text-sm font-medium text-muted">Who's splitting</h2>
              {people.map((person, index) => (
                <div key={person.id} className="flex items-center gap-2">
                  <input
                    value={person.name}
                    onChange={(e) => updatePerson(person.id, { name: e.target.value })}
                    placeholder={`Person ${index + 1}`}
                    className={inputClass}
                    aria-label={`Person ${index + 1} name`}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="radio"
                      name="payer"
                      checked={effectivePayerId === person.id}
                      onChange={() => setPayerId(person.id)}
                    />
                    paid
                  </label>
                  {people.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removePerson(person.id)}
                      className="rounded-lg border border-line px-2 text-muted transition hover:bg-canvas"
                      aria-label={`Remove person ${index + 1}`}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addPerson}
                className="text-sm font-medium text-muted transition hover:text-ink hover:underline"
              >
                + Add person
              </button>

              <label className="block pt-2 text-sm">
                <span className="mb-1 block text-xs font-medium text-muted">Which one are you?</span>
                <select
                  value={effectiveYouId}
                  onChange={(e) => setYouId(e.target.value)}
                  className={inputClass}
                  aria-label="Which one are you"
                >
                  {named.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name.trim()}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Items — one expense per row, each split its own way among everyone above */}
            <div className="mt-6 space-y-3">
              {/*
               * The running total, at the size of the thing it is.
               *
               * The group's add sheet makes the amount the biggest thing on screen because every other
               * field is a detail about it. The same is true here; it just cannot be an input, since
               * this page is a list of items rather than one figure. So it is the sum, and it is the
               * number you check against the printed receipt before you send anything to anybody.
               */}
              <div className="rounded-2xl border border-line bg-field px-4 py-5 text-center">
                <p className="tnum font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
                  {Money.fromCents(grandTotal).format()}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {grandTotal > 0
                    ? `${items.length} ${items.length === 1 ? 'item' : 'items'} · ${named.length} ${named.length === 1 ? 'person' : 'people'}`
                    : 'Add what got spent below'}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted">What you spent</h2>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={splitPayers}
                    onChange={(e) => setSplitPayers(e.target.checked)}
                  />
                  different people paid
                </label>
              </div>
              {items.map((item, index) => (
                <div key={item.id} className="surface space-y-3 rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder={`Item ${index + 1} (e.g. Dinner)`}
                      className={inputClass}
                      aria-label={`Item ${index + 1} description`}
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="rounded-lg border border-line px-2 text-muted transition hover:bg-canvas"
                        aria-label={`Remove item ${index + 1}`}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={item.amount}
                      onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                      onBlur={() => updateItem(item.id, { amount: normalizeAmountInput(item.amount) })}
                      placeholder="0.00"
                      inputMode="decimal"
                      className={`${inputClass} tnum`}
                      aria-label={`Item ${index + 1} amount`}
                    />
                    <select
                      value={item.method}
                      onChange={(e) => updateItem(item.id, { method: e.target.value as SplitMethod })}
                      className={inputClass}
                      aria-label={`Item ${index + 1} split method`}
                    >
                      {SPLIT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          Split {m.label.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  {splitPayers && named.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>paid by</span>
                      <select
                        value={item.payerId || effectivePayerId}
                        onChange={(e) => updateItem(item.id, { payerId: e.target.value })}
                        aria-label={`Item ${index + 1} paid by`}
                        className="flex-1 rounded-lg border border-line bg-field px-2 py-1.5 text-ink outline-none focus:border-accent"
                      >
                        {named.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name.trim() || 'Unnamed'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {item.method !== 'EQUAL' && named.length > 0 && (
                    <div className="space-y-1.5 border-t border-line pt-2">
                      <p className="text-xs text-muted">{splitMethodHint(item.method)}</p>
                      {named.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 truncate text-muted">{p.name.trim()}</span>
                          <input
                            value={item.values[p.id] ?? ''}
                            onChange={(e) => updateItemValue(item.id, p.id, e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="w-20 rounded-lg border border-line bg-field px-2 py-1.5 text-right outline-none focus:border-accent"
                            aria-label={`${p.name.trim()} ${splitMethodUnit(item.method)} for item ${index + 1}`}
                          />
                          <span className="w-10 text-xs text-muted">{splitMethodUnit(item.method)}</span>
                        </div>
                      ))}
                      {(() => {
                        const hint = itemSplitHint(item);
                        return hint ? (
                          <p className={`text-right text-xs tabular-nums ${hint.tone}`} aria-live="polite">
                            {hint.text}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={addItem}
                  className="text-sm font-medium text-muted transition hover:text-ink hover:underline"
                >
                  + Add item
                </button>
                <div className="flex items-center gap-1.5" aria-label="Add tip">
                  <span className="text-xs text-muted">
                    {generatedTipTotal > 0 ? `tip ${Money.fromCents(generatedTipTotal).format()}` : 'add tip'}
                  </span>
                  {[18, 20, 25].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => addTip(percent)}
                      aria-pressed={activeTip === percent}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-[0.96] ${
                        activeTip === percent
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line bg-field text-muted hover:border-accent hover:text-accent'
                      }`}
                    >
                      {percent}%
                    </button>
                  ))}
                  <label className="flex items-center rounded-full border border-line bg-field pl-2.5 text-xs text-muted focus-within:border-accent">
                    <span className="sr-only">Custom tip percentage</span>
                    <input
                      value={customTip}
                      onChange={(event) => setCustomTip(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTip(Number(customTip));
                        }
                      }}
                      placeholder="other"
                      inputMode="decimal"
                      className="w-12 bg-transparent py-1 outline-none placeholder:text-muted/70"
                    />
                    <button
                      type="button"
                      onClick={() => addTip(Number(customTip))}
                      className="px-2 py-1 font-semibold text-muted transition hover:text-ink"
                      aria-label="Apply custom tip"
                    >
                      %
                    </button>
                  </label>
                  {activeTip !== null && (
                    <button
                      type="button"
                      onClick={clearGeneratedTip}
                      className="text-xs text-muted transition hover:text-ink hover:underline"
                    >
                      remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Only once there is an answer. It used to render a heading and a promise above an empty
            space for as long as the form was blank, which is most of the time somebody spends here. */}
            {transfers && (
              <section className="mt-6">
                <h2 className="text-sm font-medium text-muted">Who owes what</h2>
                {transfers.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">All settled up. Nobody owes anybody.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {transfers.map((t) => (
                      <li
                        key={`${t.fromUserId}-${t.toUserId}`}
                        className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
                          t.fromUserId === effectiveYouId || t.toUserId === effectiveYouId
                            ? 'border border-accent/25 bg-accent-soft'
                            : 'surface'
                        }`}
                      >
                        {/* min-w-0 so this is the item that gives when a name is long: a flex child
                        will not shrink below its longest word without it, and one long name pushed
                        the whole page to 659px inside a 375px phone. The amount never shrinks —
                        it is the number everyone came for. */}
                        <span className="min-w-0">
                          <span className="font-medium">{nameById(t.fromUserId)}</span> owes{' '}
                          <span className="font-medium">{nameById(t.toUserId)}</span>
                        </span>
                        <span className="shrink-0 pl-3 font-medium tabular-nums">
                          {Money.fromCents(t.amountCents).format()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {yourShareCents !== null && (
                  <p className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm text-muted">
                    <span>your share of it</span>
                    <span className="font-medium tabular-nums text-ink">
                      {Money.fromCents(yourShareCents).format()}
                    </span>
                  </p>
                )}
                {yourPayment && (
                  <p className="mt-3 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm text-ink">
                    <span className="text-muted">your next step</span>
                    <br />
                    pay <span className="font-medium">{nameById(yourPayment.toUserId)}</span>{' '}
                    <span className="font-medium tabular-nums">
                      {Money.fromCents(yourPayment.amountCents).format()}
                    </span>
                  </p>
                )}
                {!yourPayment && yourReceive && (
                  <p className="mt-3 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm text-ink">
                    <span className="text-muted">your next step</span>
                    <br />
                    <span className="font-medium">{nameById(yourReceive.fromUserId)}</span> pays you{' '}
                    <span className="font-medium tabular-nums">
                      {Money.fromCents(yourReceive.amountCents).format()}
                    </span>
                  </p>
                )}
                {verdict && <p className="mt-2 text-sm italic text-muted">{verdict}</p>}
              </section>
            )}

            {error && (
              <p className="mt-4 text-sm font-medium text-neg" role="alert">
                {error}
              </p>
            )}
            {/* Above the save button on purpose. Saving needs an account; sending the answer to the
            people it concerns is what you actually want to do next, and it needs nothing. */}
            {transfers && (
              <button
                type="button"
                onClick={shareSummary}
                disabled={shareStatus !== null}
                aria-live="polite"
                className="mt-5 w-full rounded-full border border-line-strong px-5 py-3 font-semibold transition hover:bg-surface2 active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
              >
                {shareStatus === 'sharing'
                  ? 'Opening share…'
                  : shareStatus === 'shared'
                    ? 'Split shared'
                    : shareStatus === 'copied'
                      ? 'Split copied'
                      : 'Send it to the group chat'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="btn-gradient mt-3 w-full rounded-full px-5 py-3 font-semibold transition active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? 'Saving…' : user ? 'Save to my account' : "Save it before someone 'forgets'"}
            </button>
            {user && (
              <Link
                to="/"
                className="mt-3 block text-center text-sm font-medium text-muted transition hover:text-ink hover:underline"
              >
                Back to your groups
              </Link>
            )}
          </div>
        </div>

        {!user && (
          <section className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: 'users' as const,
                title: 'Split it any way',
                body: 'Evenly, by shares, by percent, or exact. However the argument shakes out.',
              },
              {
                icon: 'receipt' as const,
                title: 'Itemize the chaos',
                body: "Separate line items, because you didn't touch the calamari.",
              },
              {
                icon: 'wallet' as const,
                title: 'Settle up',
                body: 'We boil tangled debts down to the fewest Venmos humanly possible.',
              },
            ].map((f) => (
              <div key={f.title} className="surface rounded-2xl p-4">
                <span className="inline-grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon name={f.icon} size={18} />
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
