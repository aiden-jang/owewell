import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents } from '@owewell/shared';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { settlementsApi } from '../lib/settlements';
import { preferredMethod } from '../lib/payLinks';
import type { GroupMember } from '../lib/groups';

interface Props {
  groupId: string;
  members: GroupMember[];
  /** Who to default as the payer (usually the signed-in viewer). */
  defaultFromId?: string | undefined;
  onRecorded: () => void;
}

/** Record an arbitrary payment between two members — any amount (incl. partial), any method.
 *  Complements the one-tap "Settle" buttons, which only clear the full suggested amount. */
export function RecordPaymentForm({ groupId, members, defaultFromId, onRecorded }: Props): ReactNode {
  const memberOf = (id: string): GroupMember | undefined => members.find((m) => m.userId === id);
  const firstFrom = defaultFromId ?? members[0]?.userId ?? '';
  const firstTo = members.find((m) => m.userId !== firstFrom)?.userId ?? '';
  const [fromUserId, setFromUserId] = useState(firstFrom);
  const [toUserId, setToUserId] = useState(firstTo);
  const [amount, setAmount] = useState('');
  // Default the method to how the recipient gets paid; follows the recipient until the user
  // picks one themselves.
  const [method, setMethod] = useState<PaymentMethod>(() => preferredMethod(memberOf(firstTo)) ?? 'cash');
  const [methodTouched, setMethodTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Two members can share a display name (e.g. two placeholders both called "Alex"). Paying the
  // wrong one is a real money mistake, so disambiguate repeated names with a numeric suffix.
  const labelFor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) counts.set(m.displayName, (counts.get(m.displayName) ?? 0) + 1);
    const seen = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const m of members) {
      if ((counts.get(m.displayName) ?? 0) > 1) {
        const n = (seen.get(m.displayName) ?? 0) + 1;
        seen.set(m.displayName, n);
        labels.set(m.userId, `${m.displayName} (${n})`);
      } else {
        labels.set(m.userId, m.displayName);
      }
    }
    return labels;
  }, [members]);

  function chooseRecipient(id: string): void {
    setToUserId(id);
    if (!methodTouched) setMethod(preferredMethod(memberOf(id)) ?? 'cash');
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (fromUserId === toUserId) {
      setError('Pick two different people.');
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
    setSubmitting(true);
    try {
      await settlementsApi.record(groupId, { fromUserId, toUserId, amountCents, method });
      onRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that payment.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3.5">
      <p className="text-sm text-muted">
        Already paid someone back? Log it here so balances update. owewell doesn&rsquo;t move money.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={fromUserId}
          onChange={(e) => setFromUserId(e.target.value)}
          className={inputClass}
          aria-label="Who paid"
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {labelFor.get(m.userId) ?? m.displayName}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-sm text-muted">paid</span>
        <select
          value={toUserId}
          onChange={(e) => chooseRecipient(e.target.value)}
          className={inputClass}
          aria-label="Paid to"
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {labelFor.get(m.userId) ?? m.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          required
          className={inputClass}
          aria-label="Amount"
        />
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as PaymentMethod);
            setMethodTouched(true);
          }}
          className={inputClass}
          aria-label="Payment method"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
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
        {submitting ? 'Logging...' : 'Log payment'}
      </button>
    </form>
  );
}
