import { useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents } from '@owewell/shared';
import { DEFAULT_EXPENSE_CATEGORY, type ExpenseCategory } from '@owewell/core';
import { expensesApi, ocrReceipt, type Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';
import { normalizeAmountInput } from '../lib/format';
import { CategoryPicker } from './CategoryPicker';
import { Icon } from './Icon';

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Today as YYYY-MM-DD in the user's local timezone (for the date input default). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  onCreated: () => void;
  /** When set (an ITEMIZED expense), the form edits that receipt in place. */
  editing?: Expense;
}

export function AddItemizedExpenseForm({ groupId, members, onCreated, editing }: Props): ReactNode {
  const allMemberIds = (): Set<string> => new Set(members.map((m) => m.userId));
  const defaultPayer = editing?.payerId ?? members[0]?.userId ?? '';
  const initialItems = (): ItemDraft[] =>
    editing?.items && editing.items.length > 0
      ? editing.items.map((it) => ({
          name: it.name,
          amount: centsToInput(it.amountCents),
          participantIds: new Set(it.participantIds),
          payerId: it.payerId ?? defaultPayer,
        }))
      : [{ name: '', amount: '', participantIds: allMemberIds(), payerId: defaultPayer }];
  const [description, setDescription] = useState(editing?.description ?? '');
  const [payerId, setPayerId] = useState(defaultPayer);
  const [tax, setTax] = useState(editing?.taxCents ? centsToInput(editing.taxCents) : '');
  const [tip, setTip] = useState(editing?.tipCents ? centsToInput(editing.tipCents) : '');
  const [items, setItems] = useState<ItemDraft[]>(initialItems);
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : todayStr());
  const [category, setCategory] = useState<ExpenseCategory>(
    editing?.category ?? DEFAULT_EXPENSE_CATEGORY,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Scan a receipt photo: send it to the OCR endpoint and prefill the items + tax/tip from what
  // it reads. Everything stays editable afterward, since OCR is a starting point, not gospel.
  async function handleScan(file: File): Promise<void> {
    setScanning(true);
    setError(null);
    try {
      const receipt = await ocrReceipt(groupId, file);
      if (receipt.items.length > 0) {
        setItems(
          receipt.items.map((it) => ({
            name: it.name,
            amount: centsToInput(it.amountCents),
            participantIds: allMemberIds(),
            payerId: defaultPayer,
          })),
        );
      }
      setTax(receipt.taxCents ? centsToInput(receipt.taxCents) : '');
      setTip(receipt.tipCents ? centsToInput(receipt.tipCents) : '');
    } catch {
      setError('Could not read that receipt. Add the items by hand below.');
    } finally {
      setScanning(false);
    }
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

    const payload = { description: description.trim(), payerId, taxCents, tipCents, items: payloadItems, category, date };
    setSubmitting(true);
    try {
      if (editing) {
        await expensesApi.updateItemized(groupId, editing.id, payload);
      } else {
        await expensesApi.createItemized(groupId, payload);
        setDescription('');
        setTax('');
        setTip('');
        setItems([{ name: '', amount: '', participantIds: allMemberIds(), payerId }]);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the receipt.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3.5">
      <label
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm font-medium transition ${
          scanning
            ? 'border-accent/60 text-accent'
            : 'border-line text-muted hover:border-accent/60 hover:text-ink'
        }`}
      >
        <Icon name="scan" size={18} />
        {scanning ? 'Scanning receipt...' : 'Scan a receipt photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={scanning}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleScan(file);
            e.target.value = ''; // let the same file be picked again after an edit
          }}
        />
      </label>

      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it for?"
        required
        className={inputClass}
      />
      <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className={inputClass} aria-label="Paid by">
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

      <CategoryPicker value={category} onChange={setCategory} />

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
          className="w-full rounded-xl border border-dashed border-line-strong py-2.5 text-sm font-medium text-accent transition hover:bg-surface2"
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
        {submitting ? 'Saving...' : editing ? 'Save changes' : 'Add receipt'}
      </button>
    </form>
  );
}
