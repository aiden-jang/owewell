import { usePageTitle } from '../hooks/usePageTitle';
import { useQuickSplitDraft } from '../lib/useQuickSplitDraft';
import { QuickSplitResult } from '../components/QuickSplitResult';
import { QuickSplitTip } from '../components/QuickSplitTip';
import { SplitIntro } from '../components/SplitIntro';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money, dollarsToCents } from '@owewell/shared';
import { useAuth } from '../auth/AuthContext';
import { PublicHeader } from '../components/PublicHeader';
import { serverValue } from '../lib/splitValues';
import { computeQuickSplit } from '../lib/quickSplitResult';
import { clearQuickSplitDraft, writeQuickSplitDraft } from '../lib/quickSplitDraft';
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

export function QuickSplitPage(): ReactNode {
  usePageTitle('Split a bill');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const {
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
  } = useQuickSplitDraft();
  const [saving, setSaving] = useState(false);
  const { status: shareStatus, share } = useShareAction(setError);

  // All of it in one place, and tested: see lib/quickSplitResult.ts.
  const { named, effectivePayerId, effectiveYouId, transfers, grandTotal, yourShareCents, sharesByPerson } =
    computeQuickSplit({ people, items, payerId, youId, splitPayers });

  const nameById = (id: string): string => people.find((p) => p.id === id)?.name.trim() || 'Someone';
  // Shared summaries contain the amounts and names, without decorative copy.
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
              {/* The total stays hidden until the bill has an amount. */}
              <div className={`split-total entry-amount ${grandTotal > 0 ? '' : 'hidden'}`}>
                <span className="entry-amount-label">Bill total</span>
                <p
                  className={`tnum font-display font-medium tracking-tight ${
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
              <QuickSplitResult
                named={named}
                shares={sharesByPerson}
                transfers={transfers}
                payerId={effectivePayerId}
                yourId={effectiveYouId}
                yourShareCents={yourShareCents}
                nameById={nameById}
              />
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
