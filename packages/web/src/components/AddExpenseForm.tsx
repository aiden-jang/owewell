import { useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents, type SplitMethod } from '@owe-well/shared';
import { expensesApi } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

const METHODS: { value: SplitMethod; label: string }[] = [
  { value: 'EQUAL', label: 'Equally' },
  { value: 'SHARES', label: 'By shares' },
  { value: 'PERCENT', label: 'By percent' },
  { value: 'EXACT', label: 'Exact amounts' },
];

const VALUE_HINT: Record<SplitMethod, string> = {
  EQUAL: '',
  SHARES: 'shares',
  PERCENT: '%',
  EXACT: '$',
};

interface Props {
  groupId: string;
  members: GroupMember[];
  onCreated: () => void;
}

export function AddExpenseForm({ groupId, members, onCreated }: Props): ReactNode {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payerId, setPayerId] = useState(members[0]?.userId ?? '');
  const [method, setMethod] = useState<SplitMethod>('EQUAL');
  const [selected, setSelected] = useState<Set<string>>(new Set(members.map((m) => m.userId)));
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(userId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function buildParticipants(chosen: GroupMember[]): { userId: string; value?: number }[] {
    return chosen.map((m) => {
      if (method === 'EQUAL') return { userId: m.userId };
      const raw = (values[m.userId] ?? '').trim();
      if (method === 'EXACT') return { userId: m.userId, value: dollarsToCents(raw) };
      if (method === 'PERCENT') {
        const pct = Number(raw);
        if (!Number.isFinite(pct)) throw new Error('bad percent');
        return { userId: m.userId, value: Math.round(pct * 100) };
      }
      const weight = Number(raw);
      if (!Number.isInteger(weight) || weight <= 0) throw new Error('bad share');
      return { userId: m.userId, value: weight };
    });
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    let amountCents: number;
    try {
      amountCents = dollarsToCents(amount);
    } catch {
      setError('Enter a valid amount.');
      return;
    }
    if (amountCents <= 0) {
      setError('Amount must be more than zero.');
      return;
    }

    const chosen = members.filter((m) => selected.has(m.userId));
    if (chosen.length === 0) {
      setError('Pick at least one person.');
      return;
    }

    let participants: { userId: string; value?: number }[];
    try {
      participants = buildParticipants(chosen);
    } catch {
      setError('Check the values for each person.');
      return;
    }

    setSubmitting(true);
    try {
      await expensesApi.create(groupId, {
        description: description.trim(),
        amountCents,
        payerId,
        splitMethod: method,
        participants,
      });
      setDescription('');
      setAmount('');
      setValues({});
      setMethod('EQUAL');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the expense.');
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
      <div className="flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
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
      </div>

      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as SplitMethod)}
        className={inputClass}
        aria-label="Split method"
      >
        {METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            Split {m.label.toLowerCase()}
          </option>
        ))}
      </select>

      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={selected.has(m.userId)} onChange={() => toggle(m.userId)} />
              <span>{m.displayName}</span>
            </label>
            {method !== 'EQUAL' && selected.has(m.userId) && (
              <div className="flex items-center gap-1">
                <input
                  value={values[m.userId] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                  className="w-24 rounded-lg border border-line bg-white px-2 py-1.5 text-right outline-none focus:border-accent"
                />
                <span className="w-12 text-sm text-muted">{VALUE_HINT[method]}</span>
              </div>
            )}
          </div>
        ))}
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
        {submitting ? 'Adding...' : 'Add expense'}
      </button>
    </form>
  );
}
