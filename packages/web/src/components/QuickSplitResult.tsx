import type { ReactNode } from 'react';
import { Money, type Transfer } from '@owewell/shared';
import type { DraftPerson as Person } from '../lib/quickSplitDraft';

/** Keep computed commentary out of shared payment requests, where it would speak for the sender. */
function splitVerdict(
  named: Person[],
  shares: Record<string, number>,
  transfers: Transfer[],
  payerId: string,
): string | null {
  if (named.length < 2 || transfers.length === 0) return null;
  const nameOf = (id: string): string => named.find((p) => p.id === id)?.name.trim() || 'Someone';
  const values = named.map((p) => shares[p.id] ?? 0);
  if (values.reduce((a, b) => a + b, 0) <= 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);

  // Test exceptional splits before the common arrangement where one person pays.
  if (min === 0) {
    const free = named.find((p) => (shares[p.id] ?? 0) === 0);
    if (free) return `${free.name.trim()} owes nothing. Must be nice.`;
  }
  // Lopsided on purpose, not by a rounding cent: twice the smallest share and at least $5 apart.
  if (max >= min * 2 && max - min > 500) {
    const biggest = named.find((p) => (shares[p.id] ?? 0) === max);
    if (biggest) return `${biggest.name.trim()} got the steak.`;
  }
  // One person carrying a genuine crowd. Four is the threshold where it stops being a normal
  // dinner and starts being a favour.
  const owedTo = new Set(transfers.map((t) => t.toUserId));
  if (named.length >= 4 && owedTo.size === 1 && owedTo.has(payerId)) {
    return `${nameOf(payerId)} fronted for ${named.length - 1} people. A saint, allegedly.`;
  }
  return null;
}

type Props = {
  named: Person[];
  shares: Record<string, number> | null;
  transfers: Transfer[];
  payerId: string;
  yourId: string;
  yourShareCents: number | null;
  nameById: (id: string) => string;
};
export function QuickSplitResult({
  named,
  shares,
  transfers,
  payerId,
  yourId,
  yourShareCents,
  nameById,
}: Props): ReactNode {
  const verdict = shares ? splitVerdict(named, shares, transfers, payerId) : null;
  const yourPayment = transfers.find((transfer) => transfer.fromUserId === yourId);
  const yourReceive = transfers.find((transfer) => transfer.toUserId === yourId);
  return (
    <section className="split-result mt-6">
      <h2 className="text-sm font-medium text-muted">Who owes what</h2>
      {yourShareCents !== null && (
        <p className="split-your-share">
          <span>Your share</span>
          <span className="font-semibold tabular-nums text-ink">
            {Money.fromCents(yourShareCents).format()}
          </span>
        </p>
      )}
      {transfers.length === 0 ? (
        <p className="mt-3 text-sm text-muted">All settled up. Nobody owes anybody.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {transfers.map((t) => (
            <li
              key={`${t.fromUserId}-${t.toUserId}`}
              className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
                t.fromUserId === yourId || t.toUserId === yourId
                  ? 'border border-accent/25 bg-accent-soft'
                  : 'surface'
              }`}
            >
              {/* min-w-0 so this is the item that gives when a name is long: a flex child
                        will not shrink below its longest word without it, and one long name pushed
                        the whole page to 659px inside a 375px phone. The amount never shrinks —
                        it is the number everyone came for. */}
              <span className="min-w-0">
                <span className="font-medium">{nameById(t.fromUserId)}</span> owes{' '}
                <span className="font-medium">{nameById(t.toUserId)}</span>
              </span>
              <span className="shrink-0 pl-3 font-medium tabular-nums">
                {Money.fromCents(t.amountCents).format()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {yourPayment && (
        <p className="mt-3 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm text-ink">
          <span className="text-muted">your next step</span>
          <br />
          pay <span className="font-medium">{nameById(yourPayment.toUserId)}</span>{' '}
          <span className="font-medium tabular-nums">
            {Money.fromCents(yourPayment.amountCents).format()}
          </span>
        </p>
      )}
      {!yourPayment && yourReceive && (
        <p className="mt-3 rounded-xl border border-line bg-surface2/60 px-4 py-3 text-sm text-ink">
          <span className="text-muted">your next step</span>
          <br />
          <span className="font-medium">{nameById(yourReceive.fromUserId)}</span> pays you{' '}
          <span className="font-medium tabular-nums">
            {Money.fromCents(yourReceive.amountCents).format()}
          </span>
        </p>
      )}
      {verdict && <p className="mt-2 text-sm italic text-muted">{verdict}</p>}
    </section>
  );
}
