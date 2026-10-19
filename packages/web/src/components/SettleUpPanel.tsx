import { formatMoney as fmt } from '@owewell/shared';
import { useState, type ReactNode } from 'react';
import type { PaymentMethod } from '@owewell/core';
import { PaymentMethodSelect } from './PaymentMethodSelect';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { payLinks } from '../lib/payLinks';
import { bestSettlementStep } from '../lib/settlementGuide';
import { paymentNudgeText, type NudgeTone } from '../lib/paymentNudge';
import { useShareAction } from '../lib/useShareAction';
import type { Balance, GroupDetail } from '../lib/groups';
import type { SuggestedPayment } from '../lib/settlements';

/*
 * Who pays whom, and everything you can do about it.
 *
 * Marking a payment deliberately stays with the page: it moves the ledger, builds a receipt and
 * refetches balances. This panel only says which payment and by what method.
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
  const toast = useToast();
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('cash');
  const { status: settleShareStatus, share: sharePlan } = useShareAction(toast.error);
  const { status: nudgeShareStatus, share: shareNudge, reset: resetNudgeShare } = useShareAction(toast.error);
  const [paymentInFlight, setPaymentInFlight] = useState<string | null>(null);
  const [paymentNudge, setPaymentNudge] = useState<string | null>(null);
  const [nudgeTone, setNudgeTone] = useState<NudgeTone>('gentle');

  const settlePlanTotal = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
  // Only feeds the "Start here" flag on the top row.
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
      {/* One row at every width. Stacking it on a phone left "Share plan" sitting under the
          heading with no shape around it, reading as a subtitle rather than as the action it is. */}
      <div className="flex items-center justify-between gap-3">
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
            className="tap inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
          >
            <Icon name="share" size={13} />
            {settleShareStatus === 'sharing'
              ? 'Opening…'
              : settleShareStatus === 'shared'
                ? 'Plan shared'
                : settleShareStatus === 'copied'
                  ? 'Plan copied'
                  : 'Share plan'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pay in your usual app, then record the payment here. owewell doesn’t send money.
      </p>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface2/50 px-3 py-2 text-xs">
        <span className="text-muted">
          {suggested.length} {suggested.length === 1 ? 'transfer' : 'transfers'} left
        </span>
        <span className="tnum font-semibold text-ink">{fmt(settlePlanTotal)} remaining</span>
      </div>
      {/*
       * Directly above the buttons it governs. One control, not one per row: the answer is the same
       * for every transfer in a plan, and eight selects would be eight chances to record the wrong
       * method.
       */}
      <label className="mt-2 flex items-center justify-between gap-1.5 text-xs text-muted">
        Payment method
        <PaymentMethodSelect value={settleMethod} onChange={setSettleMethod} />
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
               * Amount on its own line above the names, with Mark paid level with it. Two real
               * names run the sentence to five lines on a 375px phone, stranding the figure at the
               * bottom, furthest from the button that records it.
               */}
              {/* Above the row, not inside the name column: it labels the whole transfer, and from
                  in there it pushed the avatar out of line with the amount. */}
              {key === recommendedPaymentKey && suggested.length > 1 && (
                <span className="block text-2xs font-semibold uppercase tracking-[0.12em] text-faint">
                  Start here
                </span>
              )}
              <span className="flex items-start justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-start gap-2.5">
                  <Avatar name={payment.fromName} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="tnum font-semibold">{fmt(payment.amountCents)}</span>
                    <span className="text-xs text-muted [overflow-wrap:anywhere]">
                      <span className="font-medium text-ink">{payment.fromName}</span> pays{' '}
                      <span className="font-medium text-ink">{payment.toName}</span>
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void markPaid(payment)}
                  title={`Record ${payment.fromName}'s payment to ${payment.toName}`}
                  /* Filled on the recommended row only. Four identical accent buttons and the
                     accent stops meaning "do this one"; START HERE marks the one that earns it. */
                  className={`tap max-w-[48%] shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
                    key === recommendedPaymentKey
                      ? 'bg-accent text-accent-ink shadow-sm shadow-accent/20 hover:brightness-110'
                      : 'border border-line-strong text-ink hover:border-accent hover:text-accent'
                  }`}
                >
                  {paymentInFlight === key ? 'Record sent payment' : 'Record payment'}
                </button>
              </span>
              {/* Indented to the text rather than the avatar, so the row has one left edge. */}
              <div className="flex flex-wrap items-center gap-1.5 pl-9">
                {linksFor(payment).map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    aria-describedby="external-link-hint"
                    rel="noreferrer"
                    onClick={() => {
                      // Opening the app is the last thing we see, so default the ledger to it.
                      setSettleMethod(link.method);
                      setPaymentInFlight(key);
                    }}
                    title={`Pay ${payment.toName} via ${link.label}`}
                    className="tap rounded-full border border-line-strong bg-surface2 px-3 py-1.5 text-xs font-medium transition hover:border-accent active:scale-[0.98]"
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
                  /* Same pill geometry as the pay links beside it, but quieter: the hairline border
                     and muted text keep it below the ones that actually move money. */
                  className="tap rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink active:scale-[0.98]"
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
                      className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-ink transition active:scale-[0.98] disabled:opacity-60"
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
