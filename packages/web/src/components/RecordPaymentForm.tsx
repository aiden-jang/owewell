import { PaymentParties, type PaymentParty } from './PaymentParties';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  formatMoney as fmt,
  currencySymbol,
  dollarsToCents,
  participantLabels,
  type MoneyFormatter,
} from '@owewell/shared';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { PaymentMethodSelect } from './PaymentMethodSelect';
import {
  hasQueuedPayment,
  preparePayment,
  queuePayment,
  settlementsApi,
  type Settlement,
  type SuggestedPayment,
} from '../lib/settlements';
import { preferredMethod } from '../lib/payLinks';
import type { GroupMember } from '../lib/groups';
import type { Balance } from '../lib/groups';
import { previewPaymentPlan } from '../lib/settlementGuide';
import { normalizeAmountInput, updateAmountInput } from '../lib/format';
import { isOffline, OUTBOX_STORAGE_ERROR } from '../lib/outbox';
import { FormError } from './FormFields';

interface Props {
  groupId: string;
  ownerId?: string | undefined;
  members: GroupMember[];
  /** Who to default as the payer (usually the signed-in viewer). */
  defaultFromId?: string | undefined;
  /** Current settle-up suggestions, offered as one-tap form presets. */
  suggestions?: SuggestedPayment[] | undefined;
  /** Live balances used only for the local what-if preview. */
  balances: Balance[];
  onRecorded: (settlement: Settlement) => void;
  /** Called instead of onRecorded when the payment could not leave the device and was queued. */
  onQueued?: (summary: string) => void;
}

function balanceCopy(cents: number, fmt: MoneyFormatter): string {
  if (cents === 0) return 'square';
  return cents > 0 ? `gets back ${fmt(cents)}` : `owes ${fmt(-cents)}`;
}

/** Record an arbitrary payment between two members — any amount (incl. partial), any method.
 *  Complements the one-tap "Settle" buttons, which only clear the full suggested amount. */
export function RecordPaymentForm({
  groupId,
  ownerId,
  members,
  defaultFromId,
  suggestions = [],
  balances,
  onRecorded,
  onQueued,
}: Props): ReactNode {
  const parties = useMemo<PaymentParty[]>(
    () => [
      ...members,
      ...balances
        .filter(
          (balance) =>
            balance.former &&
            balance.netCents !== 0 &&
            !members.some(({ userId }) => userId === balance.userId),
        )
        .map(({ userId, displayName }) => ({
          userId,
          displayName,
          venmoHandle: null,
          cashappCashtag: null,
          paypalHandle: null,
        })),
    ],
    [members, balances],
  );
  const memberOf = (id: string): PaymentParty | undefined => parties.find((party) => party.userId === id);
  const firstFrom = defaultFromId ?? parties[0]?.userId ?? '';
  const firstTo = parties.find((party) => party.userId !== firstFrom)?.userId ?? '';
  const [fromUserId, setFromUserId] = useState(firstFrom);
  const [toUserId, setToUserId] = useState(firstTo);
  const [amount, setAmount] = useState('');
  // Default the method to how the recipient gets paid; follows the recipient until the user
  // picks one themselves.
  const [method, setMethod] = useState<PaymentMethod>(() => preferredMethod(memberOf(firstTo)) ?? 'cash');
  const [methodTouched, setMethodTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const labelFor = useMemo(() => participantLabels(parties), [parties]);
  const nameOf = (id: string): string => labelFor.get(id) ?? 'Someone';

  const amountCents = useMemo(() => {
    try {
      return amount.trim() ? dollarsToCents(amount) : 0;
    } catch {
      return 0;
    }
  }, [amount]);
  const fromBalance = balances.find((balance) => balance.userId === fromUserId);
  const toBalance = balances.find((balance) => balance.userId === toUserId);
  const usefulLimit =
    fromBalance && toBalance
      ? Math.min(Math.max(0, -fromBalance.netCents), Math.max(0, toBalance.netCents))
      : 0;
  const quickAmounts = [
    ...new Set([0.25, 0.5, 0.75, 1].map((ratio) => Math.max(1, Math.round(usefulLimit * ratio)))),
  ];
  const preview = useMemo(() => {
    if (!fromBalance || !toBalance || amountCents <= 0 || fromUserId === toUserId) return null;
    return previewPaymentPlan(
      {
        fromUserId,
        fromName: fromBalance.displayName,
        toUserId,
        toName: toBalance.displayName,
        amountCents,
      },
      balances,
    );
  }, [amountCents, balances, fromBalance, fromUserId, toBalance, toUserId]);

  function chooseRecipient(id: string): void {
    setToUserId(id);
    if (!methodTouched) setMethod(preferredMethod(memberOf(id)) ?? 'cash');
  }

  function applySuggestion(suggestion: SuggestedPayment): void {
    setFromUserId(suggestion.fromUserId);
    setToUserId(suggestion.toUserId);
    setAmount((suggestion.amountCents / 100).toFixed(2));
    if (!methodTouched) setMethod(preferredMethod(memberOf(suggestion.toUserId)) ?? 'cash');
    setError(null);
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
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
    const payment = { fromUserId, toUserId, amountCents, method };
    if (hasQueuedPayment(groupId, payment, ownerId)) {
      setError('This payment is already waiting to sync.');
      return;
    }
    setSubmitting(true);
    const payload = preparePayment(groupId, payment, ownerId);
    try {
      onRecorded(await settlementsApi.record(groupId, payload, ownerId));
    } catch (err) {
      if (onQueued && isOffline(err)) {
        const summary = `${nameOf(fromUserId)} → ${nameOf(toUserId)}`;
        const saved = queuePayment(groupId, payload, summary, ownerId);
        if (saved) onQueued(summary);
        else setError(OUTBOX_STORAGE_ERROR);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not record that payment.');
    } finally {
      setSubmitting(false);
    }
  }

  const symbol = currencySymbol();

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="entry-form space-y-3.5">
      <fieldset disabled={submitting} className="entry-fields min-w-0 space-y-3.5">
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
                    onClick={() => applySuggestion(suggestion)}
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
                    <span className="tnum">
                      {(suggestion.amountCents / 100).toLocaleString(undefined, {
                        style: 'currency',
                        currency: 'USD',
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <PaymentParties
          members={parties}
          labels={labelFor}
          from={fromUserId}
          to={toUserId}
          setFrom={setFromUserId}
          setTo={chooseRecipient}
        />

        {/* Keep the amount prominent while preserving digit-based sizing on narrow screens. */}
        <div className="entry-amount">
          <span className="entry-amount-label">Payment amount</span>
          <div className="flex items-baseline justify-center gap-1">
            <span aria-hidden className="font-display text-xl font-semibold text-faint">
              {symbol}
            </span>
            <input
              value={amount}
              onChange={(e) => updateAmountInput(e.target.value, setAmount)}
              onBlur={() => setAmount(normalizeAmountInput(amount))}
              placeholder="0.00"
              inputMode="decimal"
              enterKeyHint="next"
              required
              aria-label="Amount"
              /* Sized to its own digits, as in the add sheet, so the symbol stays beside the number. */
              style={{
                width: `${Math.max(4, amount.length) + 0.3}ch`,
                maxWidth: '100%',
                minWidth: 0,
                fontSize: `clamp(1.25rem, ${90 / Math.max(4, amount.length)}vw, 2.25rem)`,
              }}
              className="tnum bg-transparent text-center font-display text-4xl font-medium tracking-tight outline-none placeholder:text-faint"
            />
          </div>
        </div>
        <label className="block text-xs text-muted">
          Payment method
          <PaymentMethodSelect
            value={method}
            onChange={(value) => {
              setMethod(value);
              setMethodTouched(true);
            }}
            className="mt-1 w-full"
          />
        </label>
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
                  className={`rounded-lg border px-2 py-1.5 text-2xs font-semibold transition ${
                    amountCents === cents
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-field text-muted hover:border-accent hover:text-ink'
                  }`}
                >
                  {index === quickAmounts.length - 1 ? 'Full' : `${Math.round((cents / usefulLimit) * 100)}%`}
                  <span className="tnum mt-0.5 block font-normal">{fmt(cents)}</span>
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
              <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-faint">
                Balance preview
              </span>
              <span className="tnum text-xs font-semibold text-ink">
                {fmt(preview.outstandingAfterCents)} left
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
                {preview.touched.map((person) => (
                  <div key={person.userId} className="rounded-xl border border-line bg-surface2/70 p-2.5">
                    <strong className="block text-xs text-ink">{person.displayName}</strong>
                    <span className="mt-1 block text-2xs text-muted">
                      <span className="tnum line-through">{balanceCopy(person.beforeCents, fmt)}</span>
                      <span aria-hidden> → </span>
                      <span
                        className={`tnum font-semibold ${person.becomesSettled ? 'text-pos' : 'text-ink'}`}
                      >
                        {balanceCopy(person.afterCents, fmt)}
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
                  {preview.remaining.map((transfer) => (
                    <li
                      key={`${transfer.fromUserId}-${transfer.toUserId}`}
                      className="flex items-center justify-between gap-3 text-2xs text-muted"
                    >
                      <span>
                        <strong className="text-ink">{transfer.fromName}</strong> → {transfer.toName}
                      </span>
                      <span className="tnum shrink-0 font-semibold text-ink">
                        {fmt(transfer.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-2xs text-muted">
                Preview only. Nothing changes until you record the payment.
              </p>
            </div>
          </section>
        )}
        {amountCents > 0 && fromUserId !== toUserId && (
          <p className="payment-record-summary">
            {nameOf(fromUserId)} paid {nameOf(toUserId)}{' '}
            <strong className="tabular-nums">{fmt(amountCents)}</strong> via {PAYMENT_METHOD_LABELS[method]}.
          </p>
        )}
      </fieldset>
      <FormError message={error} />
      <div className="form-submit-bar">
        <span role="status" className="sr-only">
          {submitting ? 'Recording payment…' : ''}
        </span>
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="btn-gradient w-full rounded-full px-4 py-3 font-semibold transition active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </form>
  );
}
