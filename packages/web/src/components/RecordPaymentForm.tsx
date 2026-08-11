import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { dollarsToCents, Money } from '@owewell/shared';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { settlementsApi, type Settlement, type SuggestedPayment } from '../lib/settlements';
import { preferredMethod } from '../lib/payLinks';
import type { GroupMember } from '../lib/groups';
import type { Balance } from '../lib/groups';
import { previewPaymentPlan } from '../lib/settlementGuide';

interface Props {
  groupId: string;
  members: GroupMember[];
  /** Who to default as the payer (usually the signed-in viewer). */
  defaultFromId?: string | undefined;
  /** Current settle-up suggestions, offered as one-tap form presets. */
  suggestions?: SuggestedPayment[] | undefined;
  /** Live balances used only for the local what-if preview. */
  balances: Balance[];
  onRecorded: (settlement: Settlement) => void;
}

function balanceCopy(cents: number): string {
  if (cents === 0) return 'square';
  return cents > 0 ? `gets back ${Money.fromCents(cents).format()}` : `owes ${Money.fromCents(-cents).format()}`;
}

/** Record an arbitrary payment between two members — any amount (incl. partial), any method.
 *  Complements the one-tap "Settle" buttons, which only clear the full suggested amount. */
export function RecordPaymentForm({ groupId, members, defaultFromId, suggestions = [], balances, onRecorded }: Props): ReactNode {
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

  const amountCents = useMemo(() => {
    try {
      return amount.trim() ? dollarsToCents(amount) : 0;
    } catch {
      return 0;
    }
  }, [amount]);
  const fromBalance = balances.find(balance => balance.userId === fromUserId);
  const toBalance = balances.find(balance => balance.userId === toUserId);
  const usefulLimit = fromBalance && toBalance
    ? Math.min(Math.max(0, -fromBalance.netCents), Math.max(0, toBalance.netCents))
    : 0;
  const quickAmounts = [...new Set([0.25, 0.5, 0.75, 1].map(ratio => Math.max(1, Math.round(usefulLimit * ratio))))];
  const preview = useMemo(() => {
    if (!fromBalance || !toBalance || amountCents <= 0 || fromUserId === toUserId) return null;
    return previewPaymentPlan({
      fromUserId,
      fromName: fromBalance.displayName,
      toUserId,
      toName: toBalance.displayName,
      amountCents,
    }, balances);
  }, [amountCents, balances, fromBalance, fromUserId, toBalance, toUserId]);

  function chooseRecipient(id: string): void {
    setToUserId(id);
    if (!methodTouched) setMethod(preferredMethod(memberOf(id)) ?? 'cash');
  }

  function useSuggestion(suggestion: SuggestedPayment): void {
    setFromUserId(suggestion.fromUserId);
    setToUserId(suggestion.toUserId);
    setAmount((suggestion.amountCents / 100).toFixed(2));
    if (!methodTouched) setMethod(preferredMethod(memberOf(suggestion.toUserId)) ?? 'cash');
    setError(null);
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
      const settlement = await settlementsApi.record(groupId, { fromUserId, toUserId, amountCents, method });
      onRecorded(settlement);
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
      {suggestions.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Use a suggested transfer</legend>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => {
              const suggestionAmount = (suggestion.amountCents / 100).toFixed(2);
              const selected =
                fromUserId === suggestion.fromUserId &&
                toUserId === suggestion.toUserId &&
                amount === suggestionAmount;
              return (
                <button
                  key={`${suggestion.fromUserId}-${suggestion.toUserId}`}
                  type="button"
                  onClick={() => useSuggestion(suggestion)}
                  aria-pressed={selected}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition active:scale-[0.98] ${
                    selected
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-field text-muted hover:border-accent hover:text-ink'
                  }`}
                >
                  <span className="block font-medium text-ink">
                    {suggestion.fromName} &rarr; {suggestion.toName}
                  </span>
                  <span className="tnum">{(suggestion.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
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
      {usefulLimit > 0 && (
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Try a partial payment</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {quickAmounts.map((cents, index) => (
              <button
                key={cents}
                type="button"
                aria-pressed={amountCents === cents}
                onClick={() => setAmount((cents / 100).toFixed(2))}
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                  amountCents === cents
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-field text-muted hover:border-accent hover:text-ink'
                }`}
              >
                {index === quickAmounts.length - 1 ? 'Full' : `${Math.round((cents / usefulLimit) * 100)}%`}
                <span className="tnum mt-0.5 block font-normal">{Money.fromCents(cents).format()}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {preview && (
        <section
          aria-live="polite"
          aria-label="Payment preview"
          className={`overflow-hidden rounded-2xl border ${
            preview.direction === 'helpful'
              ? 'border-accent/25 bg-accent-soft/45'
              : 'border-neg/30 bg-neg/5'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line/70 px-3.5 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">What if?</span>
            <span className="tnum text-xs font-semibold text-ink">
              {Money.fromCents(preview.outstandingAfterCents).format()} left
            </span>
          </div>
          <div className="p-3.5">
            {preview.direction !== 'helpful' && (
              <p className="mb-3 rounded-lg bg-neg/10 px-3 py-2 text-xs font-medium leading-relaxed text-neg">
                {preview.direction === 'overpay'
                  ? 'That is more than this pair currently owes. It would create a new debt in the other direction.'
                  : 'These balances currently point the other way. Double-check who paid whom.'}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {preview.touched.map(person => (
                <div key={person.userId} className="rounded-xl border border-line bg-surface/70 p-2.5">
                  <strong className="block text-xs text-ink">{person.displayName}</strong>
                  <span className="mt-1 block text-[11px] text-muted">
                    <span className="tnum line-through">{balanceCopy(person.beforeCents)}</span>
                    <span aria-hidden> → </span>
                    <span className={`tnum font-semibold ${person.becomesSettled ? 'text-pos' : 'text-ink'}`}>
                      {balanceCopy(person.afterCents)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted">Next settle-up plan</span>
              <strong className="text-ink">
                {preview.remaining.length === 0
                  ? 'Everyone square'
                  : `${preview.remaining.length} ${preview.remaining.length === 1 ? 'transfer' : 'transfers'}`}
              </strong>
            </div>
            {preview.remaining.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-xl border border-line bg-field/70 p-2.5">
                {preview.remaining.map(transfer => (
                  <li key={`${transfer.fromUserId}-${transfer.toUserId}`} className="flex items-center justify-between gap-3 text-[11px] text-muted">
                    <span><strong className="text-ink">{transfer.fromName}</strong> → {transfer.toName}</span>
                    <span className="tnum shrink-0 font-semibold text-ink">{Money.fromCents(transfer.amountCents).format()}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-muted">Preview only. Nothing changes until you log the payment.</p>
          </div>
        </section>
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
        {submitting ? 'Logging...' : 'Log payment'}
      </button>
    </form>
  );
}
