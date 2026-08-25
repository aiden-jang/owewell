import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents } from '@owewell/shared';
import { DEFAULT_EXPENSE_CATEGORY, type ExpenseCategory } from '@owewell/core';
import { expensesApi, type Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';
import { normalizeAmountInput, todayStr } from '../lib/format';
import { CategoryPicker } from './CategoryPicker';
import { useMoney } from '../lib/currency';
import { enqueue, isOffline } from '../lib/outbox';

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

interface ItemDraft {
  name: string;
  amount: string;
  participantIds: Set<string>;
  /** Who paid for this item. Defaults to the expense payer. */
  payerId: string;
}

interface Props {
  groupId: string;
  members: GroupMember[];
  /** Handed the saved expense so the caller can show it without waiting on a refetch. */
  onCreated: (expense: Expense) => void;
  /** When set (an ITEMIZED expense), the form edits that receipt in place. */
  editing?: Expense;
  /** Prefill a new receipt from an old one while keeping today as the date. */
  template?: Expense;
  /** Called instead of onCreated when the write could not leave the device and was queued. */
  onQueued?: (description: string) => void;
  /** The expense saved but its photo did not. Worth saying out loud; not worth failing the save. */
}

export function AddItemizedExpenseForm({
  groupId,
  members,
  onCreated,
  onQueued,
  editing,
  template,
}: Props): ReactNode {
  const fmt = useMoney();
  const source = editing ?? template;
  const allMemberIds = (): Set<string> => new Set(members.map((m) => m.userId));
  const defaultPayer =
    source && members.some((member) => member.userId === source.payerId)
      ? source.payerId
      : (members[0]?.userId ?? '');
  const initialItems = (): ItemDraft[] =>
    source?.items && source.items.length > 0
      ? source.items.map((it) => ({
          name: it.name,
          amount: centsToInput(it.amountCents),
          participantIds: new Set(
            it.participantIds.filter((id) => members.some((member) => member.userId === id)),
          ),
          payerId:
            it.payerId && members.some((member) => member.userId === it.payerId) ? it.payerId : defaultPayer,
        }))
      : [{ name: '', amount: '', participantIds: allMemberIds(), payerId: defaultPayer }];
  const [description, setDescription] = useState(source?.description ?? '');
  const [payerId, setPayerId] = useState(defaultPayer);
  const [tax, setTax] = useState(source?.taxCents ? centsToInput(source.taxCents) : '');
  const [tip, setTip] = useState(source?.tipCents ? centsToInput(source.tipCents) : '');
  const [items, setItems] = useState<ItemDraft[]>(initialItems);
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : todayStr());
  const [category, setCategory] = useState<ExpenseCategory>(source?.category ?? DEFAULT_EXPENSE_CATEGORY);
  const [note, setNote] = useState(source?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live receipt total (items + tax + tip) so you can check it against the printed total before
  // saving. Computed in integer cents to avoid float drift; blank/invalid fields count as 0.
  const grandTotalCents = useMemo(() => {
    const toCents = (s: string): number => {
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };
    return items.reduce((sum, it) => sum + toCents(it.amount), 0) + toCents(tax) + toCents(tip);
  }, [items, tax, tip]);

  function clearAfterCreate(): void {
    setDescription('');
    setTax('');
    setTip('');
    setNote('');
    setItems([{ name: '', amount: '', participantIds: allMemberIds(), payerId }]);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>): void {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function toggleParticipant(index: number, userId: string): void {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const next = new Set(item.participantIds);
        if (next.has(userId)) next.delete(userId);
        else next.add(userId);
        return { ...item, participantIds: next };
      }),
    );
  }

  function addItem(): void {
    setItems((prev) => [...prev, { name: '', amount: '', participantIds: allMemberIds(), payerId }]);
  }

  function removeItem(index: number): void {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('Add a name for this receipt.');
      return;
    }

    let payloadItems: { name: string; amountCents: number; participantIds: string[]; payerId?: string }[];
    try {
      payloadItems = items.map((item) => {
        const amountCents = dollarsToCents(item.amount);
        if (amountCents <= 0 || !item.name.trim() || item.participantIds.size === 0) {
          throw new Error('invalid item');
        }
        return {
          name: item.name.trim(),
          amountCents,
          participantIds: [...item.participantIds],
          ...(item.payerId ? { payerId: item.payerId } : {}),
        };
      });
    } catch {
      setError('Each item needs a name, an amount, and at least one person.');
      return;
    }

    let taxCents = 0;
    let tipCents = 0;
    try {
      taxCents = tax.trim() ? dollarsToCents(tax) : 0;
      tipCents = tip.trim() ? dollarsToCents(tip) : 0;
    } catch {
      setError('Check the tax and tip amounts.');
      return;
    }

    // Minted before the request, so a retry carries the same one and is recognised as this receipt.
    const clientId = crypto.randomUUID();
    // An edit says which version it was based on; a create has none to be based on.
    const versioned = editing ? { expectedVersion: editing.version } : {};
    const payload = {
      description: trimmedDescription,
      payerId,
      taxCents,
      tipCents,
      items: payloadItems,
      category,
      date,
      note: note.trim(),
      clientId,
      ...versioned,
    };
    setSubmitting(true);
    try {
      let saved: Expense;
      if (editing) {
        saved = await expensesApi.updateItemized(groupId, editing.id, payload);
      } else {
        saved = await expensesApi.createItemized(groupId, payload);
        clearAfterCreate();
      }
      onCreated(saved);
    } catch (err) {
      // The receipt is the write most worth keeping: it is the one that takes two minutes to type.
      if (editing && onQueued && isOffline(err)) {
        enqueue({
          clientId,
          groupId,
          kind: 'edit-itemized',
          expenseId: editing.id,
          description: trimmedDescription,
          amountCents: payloadItems.reduce((sum, i) => sum + i.amountCents, 0) + taxCents + tipCents,
          queuedAt: Date.now(),
          payload,
        });
        onQueued(trimmedDescription);
        return;
      }
      if (!editing && onQueued && isOffline(err)) {
        enqueue({
          clientId,
          groupId,
          kind: 'itemized',
          description: trimmedDescription,
          amountCents: payloadItems.reduce((sum, i) => sum + i.amountCents, 0) + taxCents + tipCents,
          queuedAt: Date.now(),
          payload,
        });
        clearAfterCreate();
        onQueued(trimmedDescription);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save the receipt.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3.5">
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it for?"
        required
        className={inputClass}
      />
      <select
        value={payerId}
        onChange={(e) => setPayerId(e.target.value)}
        className={inputClass}
        aria-label="Paid by"
      >
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.displayName} paid
          </option>
        ))}
      </select>

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
        className={inputClass}
      />

      {/*
       * The total, where the other tab puts the amount.
       *
       * It was a small line at the very bottom, under tax and tip, so switching between "Split a
       * total" and "Itemize a receipt" moved the money from the top of the sheet to the end of it.
       * Computed rather than typed, but it is the number you check against the printed receipt.
       */}
      <div className="rounded-2xl border border-line bg-field px-4 py-5 text-center">
        <p className="tnum font-display text-4xl font-extrabold tracking-tight">{fmt(grandTotalCents)}</p>
        <p className="mt-1 text-sm text-muted">
          {grandTotalCents > 0 ? 'Items, tax and tip' : 'Add the line items below'}
        </p>
      </div>

      <CategoryPicker value={category} onChange={setCategory} />

      {/* Optional and unlabelled on purpose: a placeholder is enough for a field nobody has to fill,
          and a label would give it the same weight as the amount. */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={280}
        placeholder="Add a note (optional)"
        aria-label="Note"
        className={inputClass}
      />

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-xl border border-line p-3">
            <div className="flex gap-2">
              <input
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
                placeholder={`Item ${index + 1}`}
                className={inputClass}
                aria-label={`Item ${index + 1} name`}
              />
              <input
                value={item.amount}
                onChange={(e) => updateItem(index, { amount: e.target.value })}
                onBlur={() => updateItem(index, { amount: normalizeAmountInput(item.amount) })}
                placeholder="0.00"
                inputMode="decimal"
                className="w-28 rounded-xl border border-line bg-field px-3 py-2.5 text-right outline-none focus:border-accent"
                aria-label={`Item ${index + 1} amount`}
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="rounded-xl border border-line px-3 text-muted transition hover:bg-canvas"
                  aria-label={`Remove item ${index + 1}`}
                >
                  &times;
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={item.participantIds.has(m.userId)}
                    onChange={() => toggleParticipant(index, m.userId)}
                  />
                  <span>{m.displayName}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <span>paid by</span>
              <select
                value={item.payerId}
                onChange={(e) => updateItem(index, { payerId: e.target.value })}
                aria-label={`Item ${index + 1} paid by`}
                className="rounded-lg border border-line bg-field px-2 py-1 text-sm text-ink outline-none focus:border-accent"
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="w-full rounded-xl border border-dashed border-line-strong py-2.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
        >
          + Add another item
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={tax}
          onChange={(e) => setTax(e.target.value)}
          onBlur={() => setTax(normalizeAmountInput(tax))}
          placeholder="Tax (optional)"
          inputMode="decimal"
          className={inputClass}
          aria-label="Tax"
        />
        <input
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          onBlur={() => setTip(normalizeAmountInput(tip))}
          placeholder="Tip (optional)"
          inputMode="decimal"
          className={inputClass}
          aria-label="Tip"
        />
      </div>

      {error && (
        <p className="text-sm font-medium text-neg" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="btn-gradient w-full rounded-full px-4 py-3 font-semibold transition active:scale-[0.98] disabled:opacity-60"
      >
        {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add receipt'}
      </button>
    </form>
  );
}
