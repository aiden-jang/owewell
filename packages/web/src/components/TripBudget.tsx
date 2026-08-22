import { useState } from 'react';
import { dollarsToCents } from '@owewell/shared';
import { budgetDetail, budgetLine, budgetTone, type TripBudget as Budget } from '../lib/tripBudget';
import { normalizeAmountInput } from '../lib/format';
import { useMoney } from '../lib/currency';

/*
 * A number the group set, and a bar showing where the spending sits against it.
 *
 * The bar is the risky part. Every budgeting app draws this in red the moment you pass the number, and
 * the effect is that people stop opening the app on the day they most need it. Here, passing the number
 * changes the bar's colour to the same accent used for "close", not to the negative colour used for money
 * you owe. The group is not in trouble; it spent more than it guessed it would.
 *
 * Non-owners see the budget and cannot change it, which matches the settle-by deadline: these are the two
 * numbers that change what everybody in the group sees.
 */

const PRESETS = [200, 500, 1_000, 2_000];

export function TripBudget({
  budget,
  budgetCents,
  isOwner,
  onSave,
}: {
  /** Null when no budget is set, or when one is set but nothing has been spent against it yet. */
  budget: Budget | null;
  budgetCents: number | null;
  isOwner: boolean;
  onSave: (budgetCents: number | null) => Promise<void>;
}) {
  const fmt = useMoney();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(cents: number | null): Promise<void> {
    setSaving(true);
    try {
      await onSave(cents);
      setEditing(false);
      setError(null);
    } catch {
      // The page owns the toast; keep the editor open so the typed amount is not thrown away.
    } finally {
      setSaving(false);
    }
  }

  function saveDraft(): void {
    let cents: number;
    try {
      cents = dollarsToCents(draft);
    } catch {
      // Caught rather than shown as a toast: the mistake is in this field, so the message belongs here.
      setError('Give that another go, as an amount like 750.');
      return;
    }
    if (cents <= 0) {
      setError('A budget needs to be more than nothing.');
      return;
    }
    void save(cents);
  }

  // Nothing to show and nothing to offer: a member without a budget has no control to see.
  if (budgetCents === null && !isOwner) return null;

  const tone = budget ? budgetTone(budget) : 'fine';
  // Clamped for the bar only. The copy above it stays honest about being past the number.
  const filled = budget ? Math.min(100, Math.round(budget.used * 100)) : 0;

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface/75 p-3" aria-label="Trip budget">
      {editing ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Set a budget</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map(amount => (
              <button
                key={amount}
                type="button"
                onClick={() => {
                  setDraft(String(amount));
                  setError(null);
                }}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
              >
                {fmt(amount * 100)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              inputMode="decimal"
              value={draft}
              placeholder="750"
              aria-label="Budget amount"
              onChange={event => {
                setDraft(event.target.value);
                setError(null);
              }}
              onBlur={event => setDraft(normalizeAmountInput(event.target.value))}
              className="min-w-0 flex-1 rounded-lg border border-line bg-field px-3 py-2 text-xs text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={saving || !draft.trim()}
              onClick={saveDraft}
              className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Set budget'}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-1.5 text-[11px] font-medium text-neg">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="mt-2 text-[11px] font-medium text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : budgetCents !== null ? (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Budget</span>
              <strong className="mt-0.5 block text-sm text-ink">
                {budget ? budgetLine(budget, fmt) : `${fmt(budgetCents)}, nothing spent yet.`}
              </strong>
              {budget && budgetDetail(budget, fmt) && (
                <small className="mt-0.5 block text-[11px] text-muted">{budgetDetail(budget, fmt)}</small>
              )}
            </span>
            {isOwner && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setDraft((budgetCents / 100).toFixed(2));
                    setEditing(true);
                  }}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
                >
                  Change
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(null)}
                  className="rounded-full px-2 py-1.5 text-xs font-medium text-muted hover:text-neg"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          <div
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={filled}
            aria-valuetext={budget ? budgetLine(budget, fmt) : 'Nothing spent yet.'}
          >
            {/* Past the number is the accent colour, not the negative one. This is not money owed. */}
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${tone === 'fine' ? 'bg-pos' : 'bg-accent'}`}
              style={{ width: `${filled}%` }}
            />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center justify-between gap-3 text-left">
          <span>
            <strong className="block text-xs text-ink">Set a budget for the trip</strong>
            <small className="mt-0.5 block text-[11px] text-muted">Everyone sees how it is going. Nobody gets told off.</small>
          </span>
          <span className="text-accent" aria-hidden>
            ＋
          </span>
        </button>
      )}
    </section>
  );
}
