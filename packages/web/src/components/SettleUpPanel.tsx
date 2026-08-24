import { useState, type ReactNode } from 'react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@owewell/core';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useMoney } from '../lib/currency';
import { payLinks } from '../lib/payLinks';
import { bestSettlementStep } from '../lib/settlementGuide';
import { paymentNudgeText, type NudgeTone } from '../lib/paymentNudge';
import { useShareAction } from '../lib/useShareAction';
import type { Balance, GroupDetail } from '../lib/groups';
import type { SuggestedPayment } from '../lib/settlements';

/*
 * Who pays whom, and everything you can do about it.
 *
 * Lifted out of the group page, which had grown past 2,600 lines. Almost all the state in here is
 * state nobody else wanted: which reminder tone is selected, and whether a share button is
 * mid-share. The page was keeping eight hooks alive for a section that renders only when somebody
 * owes somebody.
 *
 * Marking a payment deliberately stays outside: it moves the ledger, builds a receipt and refetches
 * balances, so the page owns it and this panel only says which payment and by what method.
 */

export function SettleUpPanel({
  group,
  suggested,
  balances,
  settling,
  onMarkPaid,
}: {
  group: GroupDetail;
  suggested: SuggestedPayment[];
  balances: Balance[];
  /** A mark-paid is in flight, so every button in the list is disabled. */
  settling: boolean;
  /**
   * Records the payment. Takes the method because the picker for it lives in here, and resolves
   * true when it landed, which is what clears the row's "sent it" state.
   */
  onMarkPaid: (payment: SuggestedPayment, method: PaymentMethod) => Promise<boolean>;
}): ReactNode {
  const fmt = useMoney();
  const toast = useToast();
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('cash');
  const { status: settleShareStatus, share: sharePlan } = useShareAction(toast.error);
  const { status: nudgeShareStatus, share: shareNudge, reset: resetNudgeShare } = useShareAction(toast.error);
  const [paymentInFlight, setPaymentInFlight] = useState<string | null>(null);
  const [paymentNudge, setPaymentNudge] = useState<string | null>(null);
  const [nudgeTone, setNudgeTone] = useState<NudgeTone>('gentle');

  const settlePlanTotal = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
  // Only for the "Start here" flag on the top row. This used to also feed a "Best next move" card
  // above the list, which named the same payment the top row already names and labels.
  const bestSettleStep = bestSettlementStep(balances, suggested);
  const recommendedPaymentKey = bestSettleStep
    ? `${bestSettleStep.payment.fromUserId}-${bestSettleStep.payment.toUserId}`
    : null;
  // The best next move goes first, so the list reads top-down as the order to do things in.
  const orderedSuggestions = recommendedPaymentKey
    ? [...suggested].sort((a, b) =>
        `${a.fromUserId}-${a.toUserId}` === recommendedPaymentKey
          ? -1
          : `${b.fromUserId}-${b.toUserId}` === recommendedPaymentKey
            ? 1
            : 0,
      )
    : suggested;

  function shareSettlePlan(): void {
    if (suggested.length === 0) return;
    const lines = suggested.map(
      (payment) => `• ${payment.fromName} pays ${payment.toName} ${fmt(payment.amountCents)}`,
    );
    const transferLabel = suggested.length === 1 ? 'transfer' : 'transfers';
    void sharePlan({
      title: `${group.name} settle-up`,
      text: `${group.name} settle-up\n${fmt(settlePlanTotal)} across ${suggested.length} ${transferLabel}\n\n${lines.join('\n')}`,
      failureMessage: 'Could not share the settle-up plan.',
    });
  }

  function sharePaymentNudge(payment: SuggestedPayment): void {
    void shareNudge({
      title: `${group.name} payment reminder`,
      text: nudgeTextFor(payment),
      failureMessage: 'Could not share that reminder.',
    });
  }

  async function markPaid(payment: SuggestedPayment): Promise<void> {
    if (await onMarkPaid(payment, settleMethod)) setPaymentInFlight(null);
  }

  /** A member with no handles still gets links built for them, payLinks just returns none. */
  function payeeOf(payment: SuggestedPayment) {
    return (
      group.members.find((member) => member.userId === payment.toUserId) ?? {
        venmoHandle: null,
        cashappCashtag: null,
        paypalHandle: null,
      }
    );
  }

  function linksFor(payment: SuggestedPayment) {
    return payLinks(payeeOf(payment), payment.amountCents, `owewell: ${group.name}`);
  }

  /** The preview and the share button have to read identically, so both come from here. */
  function nudgeTextFor(payment: SuggestedPayment): string {
    return paymentNudgeText(
      {
        fromName: payment.fromName,
        toName: payment.toName,
        amountCents: payment.amountCents,
        groupName: group.name,
        payUrl: linksFor(payment)[0]?.url,
      },
      nudgeTone,
      fmt,
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="wallet" size={16} /> Settle up
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={shareSettlePlan}
            disabled={settleShareStatus !== null}
            aria-label={
              settleShareStatus === 'sharing'
                ? 'Opening settle-up plan sharing'
                : settleShareStatus === 'shared'
                  ? 'Settle-up plan shared'
                  : settleShareStatus === 'copied'
                    ? 'Settle-up plan copied'
                    : 'Share settle-up plan'
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
          >
            <Icon name="share" size={13} />
            {settleShareStatus === 'sharing' ? 'Opening…' : settleShareStatus === 'shared' ? 'Plan shared' : settleShareStatus === 'copied' ? 'Plan copied' : 'Share plan'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pay in your usual app, then mark it here so the group stays in sync.
      </p>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface2/50 px-3 py-2 text-xs">
        <span className="text-muted">
          {suggested.length} {suggested.length === 1 ? 'transfer' : 'transfers'} left
        </span>
        <span className="tnum font-semibold text-ink">{fmt(settlePlanTotal)} remaining</span>
      </div>
      {/*
        * Directly above the buttons it governs, not up in the header beside "Share plan".
        *
        * It sets the method every Mark paid in the list records, but sitting in the share row it
        * read as an option for the share — and it was the one form control in a header of text
        * links, which is its own kind of wrong. It stays one control rather than one per row: the
        * answer is the same for every transfer in a plan, and eight identical selects would be
        * eight chances to record the wrong one.
        */}
      <label className="mt-2 flex items-center justify-end gap-1.5 text-xs text-muted">
        mark paid via
        <select
          value={settleMethod}
          onChange={(e) => setSettleMethod(e.target.value as PaymentMethod)}
          aria-label="Payment method"
          className="rounded-lg border border-line bg-field px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-3 space-y-2">
        {orderedSuggestions.map((payment) => {
          const key = `${payment.fromUserId}-${payment.toUserId}`;
          return (
            <li
              key={key}
              className={`flex flex-col gap-2 rounded-xl px-2 py-1.5 transition ${
                paymentInFlight === key
                  ? 'border border-accent/20 bg-accent-soft'
                  : key === recommendedPaymentKey
                    ? 'border border-line bg-surface2/40'
                    : 'border border-transparent'
              }`}
            >
              {/*
                * The sentence and the one button that acts on it, on one line.
                *
                * Everything used to share a wrapping row: on a phone that put the actions on a
                * second line pushed to the right edge while the sentence started at the left, so
                * Mark paid — the only control that touches the ledger — sat as far from its own
                * sentence as the row allowed. Pinning the two together and dropping the rest
                * underneath is one layout that holds at every width, which is also why the sm:
                * variants are gone: two arrangements meant two things to keep right.
                */}
              <span className="flex items-start justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={payment.fromName} size="sm" />
                  <span>
                    {key === recommendedPaymentKey && suggested.length > 1 && (
                      <span className="mb-0.5 block text-2xs font-semibold uppercase tracking-[0.12em] text-faint">Start here</span>
                    )}
                    <span className="font-medium">{payment.fromName}</span>
                    <span className="text-muted"> pays </span>
                    <span className="font-medium">{payment.toName}</span>{' '}
                    <span className="tnum font-medium">{fmt(payment.amountCents)}</span>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void markPaid(payment)}
                  title={`Record ${payment.fromName}'s payment to ${payment.toName}`}
                  /* The only filled control in the row. Nudge is text, the pay links are outlines,
                     and this is the one that changes the ledger. */
                  className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                >
                  {paymentInFlight === key ? 'Sent it, mark paid' : 'Mark paid'}
                </button>
              </span>
              {/* Indented to the text rather than the avatar, so the row has one left edge. */}
              <div className="flex flex-wrap items-center gap-1.5 pl-9">
                {linksFor(payment).map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      // Opening the app is the last thing we see, so default the ledger to it.
                      setSettleMethod(link.method);
                      setPaymentInFlight(key);
                    }}
                    title={`Pay ${payment.toName} via ${link.label}`}
                    className="rounded-full border border-line-strong bg-surface2 px-3 py-1.5 text-xs font-medium transition hover:border-accent active:scale-[0.98]"
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  type="button"
                  aria-expanded={paymentNudge === key}
                  onClick={() => {
                    setPaymentNudge((current) => (current === key ? null : key));
                    resetNudgeShare();
                  }}
                  /*
                   * A chip, like the pay links beside it, but a quieter one.
                   *
                   * This was a bare underlined text button, which read fine back when the actions
                   * sat right-aligned in a header-ish row. Once they became a left-aligned chip row
                   * it was the only square, borderless, transparent thing in a line of pills — 28px
                   * and radius 0 against their 30px and fully round. Same geometry now so the row
                   * is one set; the hairline border and muted text keep it below the pay links,
                   * which are the ones that actually move money.
                   */
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink active:scale-[0.98]"
                >
                  {paymentNudge === key ? 'Close nudge' : 'Nudge'}
                </button>
                {paymentInFlight === key && (
                  <span className="basis-full text-2xs text-muted" role="status">
                    Payment app opened. Record it here once it&rsquo;s sent.
                  </span>
                )}
              </div>
              {paymentNudge === key && (
                <div className="w-full basis-full rounded-xl border border-line bg-surface2/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-faint">
                      Make it sound like you
                    </p>
                    <div className="flex gap-1" role="group" aria-label="Reminder tone">
                      {(['gentle', 'direct', 'playful'] as NudgeTone[]).map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          aria-pressed={nudgeTone === tone}
                          onClick={() => setNudgeTone(tone)}
                          className={`rounded-full border px-2.5 py-1 text-2xs font-medium capitalize transition ${
                            nudgeTone === tone
                              ? 'border-accent bg-accent-soft text-accent'
                              : 'border-line bg-field text-muted hover:text-ink'
                          }`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-line rounded-lg border border-line bg-field/70 px-3 py-2.5 text-xs leading-relaxed text-ink">
                    {nudgeTextFor(payment)}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-2xs text-muted">Nothing is sent automatically.</span>
                    <button
                      type="button"
                      disabled={nudgeShareStatus !== null}
                      onClick={() => sharePaymentNudge(payment)}
                      className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                    >
                      {nudgeShareStatus === 'sharing'
                        ? 'Opening…'
                        : nudgeShareStatus === 'shared'
                          ? 'Reminder shared'
                          : nudgeShareStatus === 'copied'
                            ? 'Reminder copied'
                            : 'Send reminder'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
