import { QuickSplitTip } from '../components/QuickSplitTip';
import { SplitIntro } from '../components/SplitIntro';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money, dollarsToCents, type Transfer } from '@owewell/shared';
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
import {
  clearPendingSplit,
  quickSplitApi,
  stashPendingSplit,
  type PendingItem,
  type PendingSplit,
} from '../lib/quicksplit';
import QuickSplitItemRow from '../components/QuickSplitItemRow';
import { useShareAction } from '../lib/useShareAction';
import { inputClass } from '../components/FormFields';

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
 * ever true. Deliberately absent from the text you send to the group (see summaryText) — the app
 * can be funny at your bill, but a joke arriving in everyone else's chat reads as the sender being
 * funny at them. Returns null far more often than not.
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
  const { user, login } = useAuth();
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

  // All of it in one place, and tested: see lib/quickSplitResult.ts.
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
   * Deliberately joke-free. This lands in a conversation with
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
      failureMessage: 'Couldn’t copy the split. Try again in a moment.',
      copyOnly: true,
    });
  }

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
      // Keep the editable bill if authentication is cancelled or the visitor returns here.
      writeQuickSplitDraft({ people, items, payerId, splitPayers, youId });
      login(window.location.origin);
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

  return (
    <div className="flex-1">
      {user ? <AppHeader /> : <PublicHeader />}
      {/*
       * Two widths, the only place in the app with them: everything else is max-w-2xl end to end.
       * This page is also a landing page, and a headline penned into 672px on a laptop reads as a
       * centred phone screenshot. The tool itself stays at 2xl — a form doesn't get better wider.
       */}
      <main
        id="main"
        tabIndex={-1}
        className={`quicksplit-page mx-auto w-full animate-rise px-4 py-10 ${user ? 'max-w-2xl' : 'max-w-2xl lg:max-w-5xl'}`}
      >
        {/* The public welcome leads straight into the working calculator. Signed-in visitors
            keep the compact tool heading. */}
        <div className={user ? '' : 'split-counter'}>
          {user ? (
            <>
              <h1 className="font-display text-4xl font-semibold tracking-tight">Split a bill</h1>
              <p className="mt-2 text-base text-muted">
                Somebody paid, everybody forgot. Add the group, drop in the damage, and find out who owes who.
                No account unless you get attached.
              </p>
            </>
          ) : (
            <SplitIntro onExample={canTryExample ? tryExample : undefined} />
          )}

          {/* The form, at form width, whatever the page around it is doing. */}
          <div id="split-bill" className={`mx-auto w-full max-w-2xl ${user ? '' : 'split-receipt'}`}>
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
                <span className="mb-1 block text-xs font-medium text-muted">Who paid?</span>
                <select
                  value={effectivePayerId}
                  onChange={(event) => setPayerId(event.target.value)}
                  className={inputClass}
                  aria-label="Who paid?"
                >
                  {people.map((person, index) => (
                    <option key={person.id} value={person.id}>
                      {person.name.trim() || `Person ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
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
               * The running total, at the size of the thing it is: the number you check against the
               * printed receipt before sending anything to anybody.
               *
               * Only at that size once it IS a number. At zero it was 48px of nothing — the same
               * type size as the headline, and the largest thing a first-time visitor saw.
               */}
              <div
                className={`rounded-2xl border border-line text-center transition-all ${
                  grandTotal > 0 ? 'bg-field px-4 py-5' : 'hidden'
                }`}
              >
                <p
                  className={`tnum font-display font-extrabold tracking-tight ${
                    grandTotal > 0 ? 'text-4xl sm:text-5xl' : 'text-xl text-faint'
                  }`}
                >
                  {Money.fromCents(grandTotal).format()}
                </p>
                {grandTotal > 0 && (
                  <p className="mt-1 text-sm text-muted">
                    {`${items.length} ${items.length === 1 ? 'item' : 'items'} · ${named.length} ${named.length === 1 ? 'person' : 'people'}`}
                  </p>
                )}
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
                <QuickSplitItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  itemCount={items.length}
                  named={named}
                  splitPayers={splitPayers}
                  effectivePayerId={effectivePayerId}
                  onUpdate={updateItem}
                  onUpdateValue={updateItemValue}
                  onRemove={removeItem}
                />
              ))}
              <button
                type="button"
                onClick={addItem}
                className="text-sm font-medium text-muted transition hover:text-ink hover:underline"
              >
                + Add item
              </button>
              <QuickSplitTip
                generatedTipTotal={generatedTipTotal}
                activeTip={activeTip}
                customTip={customTip}
                setCustomTip={setCustomTip}
                addTip={addTip}
                clearGeneratedTip={clearGeneratedTip}
              />
            </div>
            {!transfers && !error && (
              <p className="split-empty">Add another person and a valid amount to see the split.</p>
            )}
            {/* Only once there is an answer: the form is blank for most of the time spent here. */}
            {transfers && (
              <section className="split-result mt-6">
                <h2 className="text-sm font-medium text-muted">Who owes what</h2>
                {yourShareCents !== null && (
                  <p className="split-your-share">
                    <span>Your share</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {Money.fromCents(yourShareCents).format()}
                    </span>
                  </p>
                )}
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
                className="btn-gradient mt-5 w-full rounded-full px-5 py-3 font-semibold transition active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
              >
                {shareStatus === 'sharing'
                  ? 'Copying…'
                  : shareStatus === 'shared'
                    ? 'Split shared'
                    : shareStatus === 'copied'
                      ? 'Split copied'
                      : 'Copy summary'}
              </button>
            )}
            {/* Disabled until there is a split to save. Full-width accent over an empty form is the
                loudest control on the page inviting you to save nothing. */}
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving || grandTotal <= 0}
              className="mt-3 w-full rounded-full border border-line-strong px-5 py-3 font-semibold transition hover:bg-surface2 active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? 'Saving…' : user ? 'Save to my account' : 'Sign in to save split'}
            </button>
            {!user && grandTotal > 0 && (
              <p className="mt-2 text-center text-xs text-muted">
                Sign in or create an account to keep this split. Copying stays free of paperwork.
              </p>
            )}
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
      </main>
    </div>
  );
}
