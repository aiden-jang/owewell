import { formatMoney as fmt } from '@owewell/shared';
import { type ReactNode } from 'react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useShareAction } from '../lib/useShareAction';
import type { GroupRecap } from '../lib/groupRecap';
import type { Settlement } from '../lib/settlements';

export function WrappedRecap({
  groupName,
  recap,
  settlements,
  memberCount,
}: {
  groupName: string;
  recap: GroupRecap;
  settlements: Settlement[];
  memberCount: number;
}): ReactNode {
  const toast = useToast();
  const { status: recapShareStatus, share } = useShareAction(toast.error);

  // The final payment is a natural handoff point: someone usually wants to tell the group that
  // nothing is hanging over them anymore. Keep the recap factual and compact so it is useful in a
  // group chat without exposing the individual balance history again.
  function shareSettledRecap(): void {
    const paymentLabel = settlements.length === 1 ? 'payment' : 'payments';
    const highlights = [
      recap.topCategory
        ? `Top category: ${recap.topCategory.emoji} ${recap.topCategory.label} (${fmt(recap.topCategory.amountCents)})`
        : null,
      recap.largest
        ? `Biggest expense: ${recap.largest.description} (${fmt(recap.largest.amountCents)})`
        : null,
      recap.daysOpen ? `Tab open for ${recap.daysOpen} ${recap.daysOpen === 1 ? 'day' : 'days'}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    void share({
      title: `${groupName} is settled`,
      text: `${groupName} is all settled \u2713\n${fmt(recap.totalCents)} split across ${memberCount} people\n${settlements.length} ${paymentLabel} recorded${highlights ? `\n\n${highlights}` : ''}`,
      failureMessage: 'Could not share the settled recap.',
    });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-accent/15 bg-gradient-to-br from-accent-soft/80 via-card to-surface2 p-5 shadow-sm shadow-accent/5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-faint">The tab, wrapped</p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">{groupName} in four numbers</h2>
          <p className="mt-1 text-sm text-muted">Nothing left to chase. Just the story of the tab.</p>
        </div>
        <span aria-hidden className="text-2xl text-accent">
          ✦
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
        <div className="rounded-2xl border border-line/70 bg-surface2/70 p-3">
          <span className="block text-2xs font-medium uppercase tracking-wide text-faint">Total spent</span>
          <strong className="mt-1 block font-display text-lg text-ink">{fmt(recap.totalCents)}</strong>
        </div>
        <div className="min-w-0 rounded-2xl border border-line/70 bg-surface2/70 p-3">
          <span className="block text-2xs font-medium uppercase tracking-wide text-faint">
            Biggest moment
          </span>
          {/* Two lines rather than one: the card is narrow enough that ordinary descriptions clip by
              a few pixels, and "Cabin, three nig…" is worse than a second line. */}
          <strong className="mt-1 line-clamp-2 block text-sm text-ink" title={recap.largest?.description}>
            {recap.largest?.description ?? 'nothing yet'}
          </strong>
          {recap.largest && (
            <span className="mt-0.5 block text-xs text-muted">{fmt(recap.largest.amountCents)}</span>
          )}
        </div>
        <div className="rounded-2xl border border-line/70 bg-surface2/70 p-3">
          <span className="block text-2xs font-medium uppercase tracking-wide text-faint">Top category</span>
          <strong className="mt-1 block text-sm text-ink">
            {recap.topCategory ? recap.topCategory.label : 'nothing yet'}
          </strong>
          {recap.topCategory && (
            <span className="mt-0.5 block text-xs text-muted">{fmt(recap.topCategory.amountCents)}</span>
          )}
        </div>
        <div className="rounded-2xl border border-line/70 bg-surface2/70 p-3">
          <span className="block text-2xs font-medium uppercase tracking-wide text-faint">Tab lifetime</span>
          <strong className="mt-1 block font-display text-lg text-ink">
            {recap.daysOpen} {recap.daysOpen === 1 ? 'day' : 'days'}
          </strong>
        </div>
      </div>

      <button
        type="button"
        onClick={shareSettledRecap}
        disabled={recapShareStatus !== null}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent transition hover:border-accent/35 hover:bg-accent/10 active:scale-[0.98] disabled:cursor-default disabled:opacity-70"
      >
        <Icon name="share" size={14} />
        {recapShareStatus === 'sharing'
          ? 'Opening…'
          : recapShareStatus === 'shared'
            ? 'Wrapped shared'
            : recapShareStatus === 'copied'
              ? 'Wrapped copied'
              : 'Share the wrapped tab'}
      </button>
    </section>
  );
}
