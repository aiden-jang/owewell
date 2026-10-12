import { useState } from 'react';
import { Money, dollarsToCents } from '@owewell/shared';
import type { SplitMethod } from '@owewell/core';
import type { DraftItem as Item, DraftPerson as Person } from '../lib/quickSplitDraft';
import { normalizeAmountInput } from '../lib/format';
import { SPLIT_METHODS, splitMethodHint, splitMethodUnit } from '../lib/splitMethods';
import { inputClass } from './FormFields';

interface QuickSplitItemRowProps {
  item: Item;
  index: number;
  itemCount: number;
  /** Everyone with a name, which is who an item can be assigned to. */
  named: Person[];
  splitPayers: boolean;
  /** Who pays when the row does not say, so the row can show it as the default. */
  effectivePayerId: string;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onUpdateValue: (itemId: string, personId: string, value: string) => void;
  onRemove: (id: string) => void;
}

// Live running total for one item's non-equal split, so values that don't add up are visible
// before saving. Mirrors the group expense form.
function itemSplitHint(item: Item, named: Person[]): { text: string; tone: string } | null {
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
    const tone = !ok ? 'text-neg' : rounded === 100 ? 'text-pos' : rounded > 100 ? 'text-neg' : 'text-muted';
    return { text: `${rounded}% of 100%`, tone };
  }
  let sum = 0;
  for (const r of raws) {
    const n = Number(r);
    if (Number.isFinite(n)) sum += n;
  }
  return { text: `${sum} share${sum === 1 ? '' : 's'} total`, tone: 'text-muted' };
}

/* One line of the receipt: what it was, what it cost, who is on it, and how it divides. Its own
   component because it is the piece that repeats, in a page that is otherwise one long form. */
export default function QuickSplitItemRow({
  item,
  index,
  itemCount,
  named,
  splitPayers,
  effectivePayerId,
  onUpdate,
  onUpdateValue,
  onRemove,
}: QuickSplitItemRowProps) {
  const [expanded, setExpanded] = useState(item.method !== 'EQUAL' || !!item.description || itemCount > 1);
  let amountError: string | null = null;
  if (item.amount.trim()) {
    try {
      if (dollarsToCents(item.amount) <= 0) amountError = 'Enter an amount greater than zero.';
    } catch {
      amountError = 'Enter a valid amount, such as 24.50.';
    }
  }
  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <label className="split-amount-label">
        <span>{itemCount === 1 ? 'Bill amount' : `Item ${index + 1} amount`}</span>
        <input
          value={item.amount}
          onChange={(e) => onUpdate(item.id, { amount: e.target.value })}
          onBlur={() => onUpdate(item.id, { amount: normalizeAmountInput(item.amount) })}
          placeholder="0.00"
          inputMode="decimal"
          className={`${inputClass} tnum split-amount-input`}
          aria-label={`Item ${index + 1} amount`}
          aria-invalid={amountError !== null}
          aria-describedby={amountError ? `amount-error-${item.id}` : undefined}
        />
      </label>
      {amountError && (
        <p id={`amount-error-${item.id}`} className="text-sm text-neg" role="alert">
          {amountError}
        </p>
      )}
      <details
        className="split-item-options"
        open={expanded || splitPayers}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Details & split options</summary>
        <div className="flex items-center gap-2">
          <input
            value={item.description}
            onChange={(e) => onUpdate(item.id, { description: e.target.value })}
            placeholder={`Item ${index + 1} (e.g. Dinner)`}
            className={inputClass}
            aria-label={`Item ${index + 1} description`}
          />
          {itemCount > 1 && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="rounded-lg border border-line px-2 text-muted transition hover:bg-canvas"
              aria-label={`Remove item ${index + 1}`}
            >
              &times;
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={item.method}
            onChange={(e) => onUpdate(item.id, { method: e.target.value as SplitMethod })}
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
              onChange={(e) => onUpdate(item.id, { payerId: e.target.value })}
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
                  onChange={(e) => onUpdateValue(item.id, p.id, e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className="w-20 rounded-lg border border-line bg-field px-2 py-1.5 text-right outline-none focus:border-accent"
                  aria-label={`${p.name.trim()} ${splitMethodUnit(item.method)} for item ${index + 1}`}
                />
                <span className="w-10 text-xs text-muted">{splitMethodUnit(item.method)}</span>
              </div>
            ))}
            {(() => {
              const hint = itemSplitHint(item, named);
              return hint ? (
                <p className={`text-right text-xs tabular-nums ${hint.tone}`} aria-live="polite">
                  {hint.text}
                </p>
              ) : null;
            })()}
          </div>
        )}
      </details>
    </div>
  );
}
