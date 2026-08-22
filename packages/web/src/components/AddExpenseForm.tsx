import { useState, type FormEvent, type ReactNode } from 'react';
import { DEFAULT_EXPENSE_CATEGORY, type ExpenseCategory } from '@owewell/core';
import { CategoryPicker } from './CategoryPicker';
import { Money, dollarsToCents, type SplitMethod } from '@owewell/shared';
import { expensesApi, type Expense } from '../lib/expenses';
import { normalizeAmountInput, todayStr } from '../lib/format';
import type { GroupMember } from '../lib/groups';
import { SPLIT_METHODS, splitMethodHint, splitMethodUnit } from '../lib/splitMethods';

interface Props {
  groupId: string;
  members: GroupMember[];
  /** Handed the saved expense so the caller can show it without waiting on a refetch. */
  onCreated: (expense: Expense) => void;
  /** When set, the form edits this expense in place instead of creating a new one. */
  editing?: Expense;
  /** Prefill a new expense from an old one while keeping today as the date. */
  template?: Expense;
}

/** Reverse the form's value encoding so an edited expense prefills what the payer entered. */
function initialValues(editing: Expense | undefined): Record<string, string> {
  if (!editing || editing.splitMethod === 'ITEMIZED' || editing.splitMethod === 'EQUAL') return {};
  const method = editing.splitMethod;
  const out: Record<string, string> = {};
  for (const s of editing.splits) {
    if (s.inputValue == null) continue;
    if (method === 'EXACT') out[s.userId] = (s.inputValue / 100).toFixed(2);
    else if (method === 'PERCENT') out[s.userId] = String(s.inputValue / 100);
    else out[s.userId] = String(s.inputValue); // SHARES
  }
  return out;
}

export function AddExpenseForm({ groupId, members, onCreated, editing, template }: Props): ReactNode {
  const source = editing ?? template;
  const sourcePayer = source && members.some((member) => member.userId === source.payerId)
    ? source.payerId
    : members[0]?.userId ?? '';
  const [description, setDescription] = useState(source?.description ?? '');
  const [amount, setAmount] = useState(source ? (source.amountCents / 100).toFixed(2) : '');
  const [payerId, setPayerId] = useState(sourcePayer);
  const [method, setMethod] = useState<SplitMethod>(
    source && source.splitMethod !== 'ITEMIZED' ? source.splitMethod : 'EQUAL',
  );
  const [selected, setSelected] = useState<Set<string>>(
    source
      ? new Set(source.splits.map((s) => s.userId).filter((id) => members.some((member) => member.userId === id)))
      : new Set(members.map((m) => m.userId)),
  );
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(source));
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : todayStr());
  const [category, setCategory] = useState<ExpenseCategory>(
    source?.category ?? DEFAULT_EXPENSE_CATEGORY,
  );
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
      if (method === 'EXACT') {
        const cents = dollarsToCents(raw);
        if (cents < 0) throw new Error('negative amount');
        return { userId: m.userId, value: cents };
      }
      if (method === 'PERCENT') {
        const pct = Number(raw);
        if (!Number.isFinite(pct) || pct < 0) throw new Error('bad percent');
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

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('Add a short description.');
      return;
    }

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

    // Custom splits have to reconcile before we save, otherwise the group's math is wrong from the
    // start. The live hint already shows the running total; this stops a submit that doesn't add up.
    if (method === 'EXACT') {
      const sum = participants.reduce((acc, p) => acc + (p.value ?? 0), 0);
      if (sum !== amountCents) {
        setError(
          `The amounts need to add up to ${Money.fromCents(amountCents).format()}. Right now they total ${Money.fromCents(sum).format()}.`,
        );
        return;
      }
    }
    if (method === 'PERCENT') {
      const bps = participants.reduce((acc, p) => acc + (p.value ?? 0), 0);
      if (bps !== 10000) {
        setError(`The percentages need to add up to 100%. Right now they total ${(bps / 100).toFixed(2)}%.`);
        return;
      }
    }

    const payload = { description: trimmedDescription, amountCents, payerId, splitMethod: method, participants, category, date };
    setSubmitting(true);
    try {
      let saved: Expense;
      if (editing) {
        saved = await expensesApi.update(groupId, editing.id, payload);
      } else {
        saved = await expensesApi.create(groupId, payload);
        setDescription('');
        setAmount('');
        setValues({});
        setMethod('EQUAL');
      }
      onCreated(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expense.');
    } finally {
      setSubmitting(false);
    }
  }

  // Live running total for the non-equal methods, so the user sees whether their per-person
  // values add up before hitting submit.
  let splitHint: { text: string; tone: string } | null = null;
  if (method !== 'EQUAL') {
    const chosen = members.filter((m) => selected.has(m.userId));
    const raws = chosen.map((m) => (values[m.userId] ?? '').trim()).filter(Boolean);
    if (method === 'EXACT') {
      let sum = 0;
      let ok = true;
      for (const raw of raws) {
        try {
          sum += dollarsToCents(raw);
        } catch {
          ok = false;
        }
      }
      let target = 0;
      try {
        target = amount.trim() ? dollarsToCents(amount) : 0;
      } catch {
        target = 0;
      }
      const tone = !ok ? 'text-neg' : target > 0 && sum === target ? 'text-pos' : sum > target ? 'text-neg' : 'text-muted';
      splitHint = { text: `${Money.fromCents(sum).format()} of ${Money.fromCents(target).format()} assigned`, tone };
    } else if (method === 'PERCENT') {
      let sum = 0;
      let ok = true;
      for (const raw of raws) {
        const n = Number(raw);
        if (Number.isFinite(n)) sum += n;
        else ok = false;
      }
      const rounded = Math.round(sum * 100) / 100;
      const tone = !ok ? 'text-neg' : rounded === 100 ? 'text-pos' : rounded > 100 ? 'text-neg' : 'text-muted';
      splitHint = { text: `${rounded}% of 100%`, tone };
    } else {
      let sum = 0;
      for (const raw of raws) {
        const n = Number(raw);
        if (Number.isFinite(n)) sum += n;
      }
      splitHint = { text: `${sum} share${sum === 1 ? '' : 's'} total`, tone: 'text-muted' };
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
        aria-label="What the expense was for"
        required
        className={inputClass}
      />
      <div className="flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => setAmount(normalizeAmountInput(amount))}
          placeholder="0.00"
          inputMode="decimal"
          aria-label="Amount"
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

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
        className={inputClass}
      />

      <CategoryPicker value={category} onChange={setCategory} />

      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as SplitMethod)}
        className={inputClass}
        aria-label="Split method"
      >
        {SPLIT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            Split {m.label.toLowerCase()}
          </option>
        ))}
      </select>

      {method !== 'EQUAL' && <p className="-mt-1 text-xs text-muted">{splitMethodHint(method)}</p>}

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
                  aria-label={
                    method === 'EXACT'
                      ? `Amount for ${m.displayName}`
                      : method === 'PERCENT'
                        ? `Percent for ${m.displayName}`
                        : `Shares for ${m.displayName}`
                  }
                  className="w-24 rounded-lg border border-line bg-field px-2 py-1.5 text-right outline-none focus:border-accent"
                />
                <span className="w-12 text-sm text-muted">{splitMethodUnit(method)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {splitHint && (
        <p className={`text-right text-sm tabular-nums ${splitHint.tone}`} aria-live="polite">
          {splitHint.text}
        </p>
      )}

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
        {submitting ? 'Saving...' : editing ? 'Save changes' : 'Add expense'}
      </button>
    </form>
  );
}
