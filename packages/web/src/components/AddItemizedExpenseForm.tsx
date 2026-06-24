import { useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents } from '@owe-well/shared';
import { expensesApi } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

interface ItemDraft {
  name: string;
  amount: string;
  participantIds: Set<string>;
}

interface Props {
  groupId: string;
  members: GroupMember[];
  onCreated: () => void;
}

export function AddItemizedExpenseForm({ groupId, members, onCreated }: Props): ReactNode {
  const allMemberIds = (): Set<string> => new Set(members.map((m) => m.userId));
  const [description, setDescription] = useState('');
  const [payerId, setPayerId] = useState(members[0]?.userId ?? '');
  const [tax, setTax] = useState('');
  const [tip, setTip] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([
    { name: '', amount: '', participantIds: allMemberIds() },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    setItems((prev) => [...prev, { name: '', amount: '', participantIds: allMemberIds() }]);
  }

  function removeItem(index: number): void {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    let payloadItems: { name: string; amountCents: number; participantIds: string[] }[];
    try {
      payloadItems = items.map((item) => {
        const amountCents = dollarsToCents(item.amount);
        if (amountCents <= 0 || !item.name.trim() || item.participantIds.size === 0) {
          throw new Error('invalid item');
        }
        return { name: item.name.trim(), amountCents, participantIds: [...item.participantIds] };
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

    setSubmitting(true);
    try {
      await expensesApi.createItemized(groupId, {
        description: description.trim(),
        payerId,
        taxCents,
        tipCents,
        items: payloadItems,
      });
      setDescription('');
      setTax('');
      setTip('');
      setItems([{ name: '', amount: '', participantIds: allMemberIds() }]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the receipt.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-white px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mt-3 space-y-3 rounded-2xl border border-line bg-card p-4">
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
                placeholder="0.00"
                inputMode="decimal"
                className="w-28 rounded-xl border border-line bg-white px-3 py-2.5 text-right outline-none focus:border-accent"
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
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="text-sm font-medium text-accent transition hover:underline"
        >
          + Add item
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={tax}
          onChange={(e) => setTax(e.target.value)}
          placeholder="Tax (optional)"
          inputMode="decimal"
          className={inputClass}
          aria-label="Tax"
        />
        <input
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          placeholder="Tip (optional)"
          inputMode="decimal"
          className={inputClass}
          aria-label="Tip"
        />
      </div>

      {error && (
        <p className="text-sm font-medium text-accent" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
      >
        {submitting ? 'Adding...' : 'Add receipt'}
      </button>
    </form>
  );
}
