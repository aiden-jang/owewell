import { usePageTitle } from '../hooks/usePageTitle';
import { useQuickSplitDraft } from '../lib/useQuickSplitDraft';
import { QuickSplitResult } from '../components/QuickSplitResult';
import { QuickSplitTip } from '../components/QuickSplitTip';
import { QuickSplitDraftNotice } from '../components/QuickSplitDraftNotice';
import { SplitIntro } from '../components/SplitIntro';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Money } from '@owewell/shared';
import { useAuth } from '../auth/AuthContext';
import { PublicHeader } from '../components/PublicHeader';
import { QUICK_SPLIT_LIMITS } from '@owewell/core';
import { useSaveQuickSplit } from '../lib/useSaveQuickSplit';
import { computeQuickSplit } from '../lib/quickSplitResult';
import { AppHeader } from '../components/AppHeader';
import QuickSplitItemRow from '../components/QuickSplitItemRow';
import { useShareAction } from '../lib/useShareAction';
import { inputClass } from '../components/FormFields';
import { SelectField } from '../components/SelectField';
import { SessionNotice } from '../components/SessionNotice';
import { useConfirm } from '../components/Confirm';

export function QuickSplitPage(): ReactNode {
  usePageTitle('Split a bill');
  const { user, loading, sessionError } = useAuth();
  const confirm = useConfirm();
  const billDetails = useRef<HTMLFieldSetElement>(null);
  const {
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
  } = useQuickSplitDraft(user?.id);
  const { saving, save } = useSaveQuickSplit(setError, persistDraft, finishDraft);
  const { status: shareStatus, share } = useShareAction(setError);

  const { named, effectivePayerId, effectiveYouId, transfers, grandTotal, yourShareCents, sharesByPerson } =
    computeQuickSplit({ people, items, payerId, youId, splitPayers });
  const itemCount = items.filter((item) => item.amount.trim()).length;
  const overItemLimit = itemCount > QUICK_SPLIT_LIMITS.items;

  const nameById = (id: string): string => people.find((p) => p.id === id)?.name.trim() || 'Someone';
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

  async function confirmStartFresh(): Promise<void> {
    const discard = await confirm({
      title: 'Discard this bill and start fresh?',
      body: 'This draft will be cleared from this device.',
      confirmLabel: 'Discard and start fresh',
      cancelLabel: 'Keep draft',
      tone: 'danger',
    });
    if (!discard) return;
    startFresh();
    requestAnimationFrame(() => billDetails.current?.focus({ preventScroll: true }));
  }

  return (
    <div className="flex-1">
      {user ? <AppHeader /> : <PublicHeader />}
      <main
        id="main"
        tabIndex={-1}
        className="workspace-width quicksplit-page mx-auto w-full animate-rise px-4 py-10"
      >
        <div className="split-counter">
          {user ? (
            <>
              <h1 className="font-display text-4xl font-semibold tracking-tight">Split a bill</h1>
              <p className="mt-2 text-muted">Work out each person’s share.</p>
            </>
          ) : (
            <SplitIntro onExample={canTryExample ? tryExample : undefined} />
          )}

          <div id="split-bill" className="split-layout">
            <QuickSplitDraftNotice
              restored={draftRestored}
              otherDrafts={otherDrafts}
              saving={saving}
              onStartFresh={confirmStartFresh}
              onRestore={restoreDraft}
            />

            <fieldset
              ref={billDetails}
              tabIndex={-1}
              className="split-receipt"
              disabled={saving}
              aria-label="Bill details"
            >
              <div className="surface space-y-2">
                <h2 className="text-sm font-medium text-muted">Who's splitting</h2>
                {people.map((person, index) => (
                  <div key={person.id} className="flex items-center gap-2">
                    <input
                      maxLength={QUICK_SPLIT_LIMITS.name}
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
                        className="tap grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-canvas"
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
                  disabled={people.length >= QUICK_SPLIT_LIMITS.people}
                  className="text-sm font-medium text-muted transition hover:text-ink hover:underline disabled:opacity-50"
                >
                  + Add person
                </button>

                <label className="block pt-2 text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted">Who paid?</span>
                  <SelectField
                    value={effectivePayerId}
                    onChange={(event) => setPayerId(event.target.value)}
                    className={inputClass}
                    aria-label="Who paid?"
                  >
                    {named.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name.trim()}
                      </option>
                    ))}
                  </SelectField>
                </label>
                <label className="block pt-2 text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted">Which one are you?</span>
                  <SelectField
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
                  </SelectField>
                </label>
              </div>

              <div className="mt-6 space-y-3">
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
                  disabled={items.length >= QUICK_SPLIT_LIMITS.items}
                  className="text-sm font-medium text-muted transition hover:text-ink hover:underline disabled:opacity-50"
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
            </fieldset>
            <div className="split-summary surface">
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
                    {`${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${named.length} ${named.length === 1 ? 'person' : 'people'}`}
                  </p>
                )}
              </div>
              {!transfers && !error && (
                <div className="mt-3">
                  <h2 className="font-semibold">Split summary</h2>
                  <p className="split-empty">Add another person and a valid amount to see the split.</p>
                </div>
              )}
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
              <SessionNotice />
              <div role="status">
                {overItemLimit && (
                  <p id="split-item-limit" className="mt-3 text-sm font-medium text-neg">
                    This bill has {itemCount} items. You can save up to {QUICK_SPLIT_LIMITS.items} including
                    tips.
                    {activeTip
                      ? ' Remove items or turn off automatic tips to save.'
                      : ' Remove items to save.'}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void save(draft, effectivePayerId, effectiveYouId)}
                aria-describedby={overItemLimit ? 'split-item-limit' : undefined}
                disabled={saving || transfers === null || loading || sessionError || overItemLimit}
                className="mt-3 w-full rounded-full border border-line-strong px-5 py-3 font-semibold transition hover:bg-surface2 active:scale-[0.98] disabled:opacity-60"
              >
                {loading
                  ? 'Checking sign-in…'
                  : saving
                    ? 'Saving…'
                    : user
                      ? 'Save to my account'
                      : 'Sign in to save split'}
              </button>
              {!user && !loading && !sessionError && grandTotal > 0 && (
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
        </div>
      </main>
    </div>
  );
}
