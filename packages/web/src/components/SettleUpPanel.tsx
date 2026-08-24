import { useState, type ReactNode } from 'react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@owewell/core';
import type { MoneyFormatter } from '@owewell/shared';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useMoney } from '../lib/currency';
import { payLinks } from '../lib/payLinks';
import { renderSettleCard } from '../lib/settleCard';
import { bestSettlementStep, projectBalancesAfterPayment } from '../lib/settlementGuide';
import { paymentNudgeText, type NudgeTone } from '../lib/paymentNudge';
import { CONFIRM_MS } from '../lib/timing';
import { useShareAction } from '../lib/useShareAction';
import type { Balance, GroupDetail } from '../lib/groups';
import type { SuggestedPayment } from '../lib/settlements';

/*
 * Who pays whom, and everything you can do about it.
 *
 * Lifted out of the group page, which had grown past 2,600 lines. Almost all the state in here is
 * state nobody else wanted: which reminder tone is selected, whether a preview row is open, whether
 * a share button is mid-share. The page was keeping eight hooks alive for a section that renders
 * only when somebody owes somebody.
 *
 * Marking a payment deliberately stays outside: it moves the ledger, builds a receipt and refetches
 * balances, so the page owns it and this panel only says which payment and by what method.
 */

/** "is owed $12.00" / "owes $8.00" / "square", for the before-and-after preview. */
function balanceStateLabel(netCents: number, fmt: MoneyFormatter): string {
  if (netCents === 0) return 'square';
  const amount = fmt(Math.abs(netCents));
  return netCents > 0 ? `is owed ${amount}` : `owes ${amount}`;
}

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
  const [settleCardStatus, setSettleCardStatus] = useState<'making' | 'shared' | 'saved' | null>(null);
  const [paymentInFlight, setPaymentInFlight] = useState<string | null>(null);
  const [paymentPreview, setPaymentPreview] = useState<string | null>(null);
  const [paymentNudge, setPaymentNudge] = useState<string | null>(null);
  const [nudgeTone, setNudgeTone] = useState<NudgeTone>('gentle');

  const settlePlanTotal = suggested.reduce((sum, payment) => sum + payment.amountCents, 0);
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

  async function shareSettleCard(): Promise<void> {
    if (suggested.length === 0 || settleCardStatus) return;
    setSettleCardStatus('making');
    try {
      const blob = await renderSettleCard(group.name, suggested, fmt);
      if (!blob) {
        setSettleCardStatus(null);
        toast.error('Could not make the settle-up card.');
        return;
      }
      const slug = group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
      const file = new File([blob], `${slug}-settle-up.png`, { type: 'image/png' });
      const canShare = typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
      if (canShare) {
        try {
          await navigator.share({ title: `${group.name} settle-up`, files: [file] });
          setSettleCardStatus('shared');
          window.setTimeout(() => setSettleCardStatus(null), CONFIRM_MS);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setSettleCardStatus(null);
            return;
          }
        }
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
      setSettleCardStatus('saved');
      window.setTimeout(() => setSettleCardStatus(null), CONFIRM_MS);
    } catch {
      setSettleCardStatus(null);
      toast.error('Could not make the settle-up card.');
    }
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
          <button
            type="button"
            onClick={() => void shareSettleCard()}
            disabled={settleCardStatus !== null}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink hover:underline disabled:cursor-default disabled:opacity-70"
          >
            <Icon name="sparkles" size={13} />
            {settleCardStatus === 'making' ? 'Making…' : settleCardStatus === 'shared' ? 'Card shared' : settleCardStatus === 'saved' ? 'Card saved' : 'Share card'}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            paid via
            <select
              value={settleMethod}
              onChange={(e) => setSettleMethod(e.target.value as PaymentMethod)}
              aria-label="Payment method"
              className="rounded-lg border border-line bg-field px-2 py-1 text-xs outline-none focus:border-accent"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pay in your usual app, then mark it here so the group stays in sync.
      </p>
      {bestSettleStep && (
        <div className="mt-3 rounded-xl border border-line bg-surface2/60 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-faint">Best next move</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {bestSettleStep.payment.fromName} pays {bestSettleStep.payment.toName}{' '}
                <span className="tnum text-ink">{fmt(bestSettleStep.payment.amountCents)}</span>
              </p>
            </div>
            <span className="tnum shrink-0 rounded-full bg-surface2 px-2.5 py-1 text-xs font-semibold text-muted">
              −{bestSettleStep.percentOfOutstanding}%
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {bestSettleStep.remainingTransfers === 0
              ? 'One payment settles the whole group.'
              : bestSettleStep.clearedNames.length > 0
                ? `Clears ${bestSettleStep.clearedNames.join(' and ')} from the list, with ${bestSettleStep.remainingTransfers} ${bestSettleStep.remainingTransfers === 1 ? 'transfer' : 'transfers'} left.`
                : `${fmt(bestSettleStep.remainingCents)} would remain after this.`}
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface2/50 px-3 py-2 text-xs">
        <span className="text-muted">
          {suggested.length} {suggested.length === 1 ? 'transfer' : 'transfers'} left
        </span>
        <span className="tnum font-semibold text-ink">{fmt(settlePlanTotal)} remaining</span>
      </div>
      <ul className="mt-3 space-y-2">
        {orderedSuggestions.map((payment) => {
          const key = `${payment.fromUserId}-${payment.toUserId}`;
          return (
            <li
              key={key}
              className={`flex flex-col gap-2 rounded-xl px-2 py-1.5 transition sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${
                paymentInFlight === key
                  ? 'border border-accent/20 bg-accent-soft'
                  : key === recommendedPaymentKey
                    ? 'border border-line bg-surface2/40'
                    : 'border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2 text-sm">
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
              <div className="flex flex-wrap items-center justify-end gap-1.5 pl-9 sm:pl-0">
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
                    setPaymentPreview(null);
                    resetNudgeShare();
                  }}
                  className="px-1.5 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:text-ink hover:underline"
                >
                  {paymentNudge === key ? 'Close nudge' : 'Nudge'}
                </button>
                <button
                  type="button"
                  aria-expanded={paymentPreview === key}
                  onClick={() => {
                    setPaymentPreview((current) => (current === key ? null : key));
                    setPaymentNudge(null);
                  }}
                  className="px-1.5 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:text-ink hover:underline"
                >
                  {paymentPreview === key ? 'Hide preview' : 'Preview'}
                </button>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void markPaid(payment)}
                  title={`Record ${payment.fromName}'s payment to ${payment.toName}`}
                  /* The only filled control in the row. Nudge and Preview are text, the pay links
                     are outlines, and this is the one that changes the ledger. */
                  className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                >
                  {paymentInFlight === key ? 'Sent it, mark paid' : 'Mark paid'}
                </button>
                {paymentInFlight === key && (
                  <span className="basis-full text-right text-2xs text-muted" role="status">
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
              {paymentPreview === key && (
                <div className="w-full basis-full rounded-lg border border-line bg-field/70 px-3 py-2.5" role="status">
                  <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-faint">
                    After this payment
                  </p>
                  <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {projectBalancesAfterPayment(payment, balances).map((projected) => (
                      <p key={projected.userId} className="text-xs text-muted">
                        <span className="font-medium text-ink">{projected.displayName}</span>{' '}
                        <span className="tnum">{balanceStateLabel(projected.beforeCents, fmt)}</span>
                        <span aria-hidden> → </span>
                        <span className={`tnum font-medium ${projected.becomesSettled ? 'text-pos' : 'text-ink'}`}>
                          {balanceStateLabel(projected.afterCents, fmt)}
                        </span>
                      </p>
                    ))}
                  </div>
                  <p className="mt-1.5 text-2xs text-muted">
                    Preview only. Nothing changes until you mark it paid.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
