import { useState, type ReactNode } from 'react';
import { Money } from '@owewell/shared';
import type { GroupMember } from '@owewell/core';
import type { RecurringRule } from '../lib/recurring';
import { play } from '../lib/sound';

/*
 * "This is due again."
 *
 * The card that makes recurring bills worth having, and the reason nothing is created automatically.
 * A rule could perfectly well add rent on the 1st by itself, and the first time it did it while
 * somebody was asleep the app would have moved money between friends without either of them looking.
 * Being right about the schedule is no defence against "I never agreed to that", so a rule proposes
 * and a person taps.
 *
 * Overdue months are shown oldest first and dealt with one at a time rather than in a batch. Rent for
 * three separate months is three different amounts of money to somebody who has been away, and a
 * single "add all" button is how you end up adding a bill that was already settled in cash.
 */

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  // Constructed in UTC and read in UTC, so the label never slips a day on either side of the world.
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function RecurringDue({
  rules,
  members,
  onAccept,
  onSkip,
}: {
  rules: RecurringRule[];
  members: GroupMember[];
  onAccept: (ruleId: string, on: string) => Promise<void>;
  onSkip: (ruleId: string, on: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  const due = rules.filter((rule) => rule.active && rule.dueDates.length > 0);
  if (due.length === 0) return null;

  const nameOf = (id: string): string => members.find((m) => m.userId === id)?.displayName ?? 'Someone';

  async function run(key: string, action: () => Promise<void>, cue: 'add' | 'tick'): Promise<void> {
    setBusy(key);
    try {
      await action();
      play(cue);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="recurring-due-heading"
      className="rounded-2xl border border-accent/30 bg-accent/10 p-4"
    >
      <h2 id="recurring-due-heading" className="font-display text-base font-semibold">
        {due.length === 1 ? 'Something came round again' : 'A few things came round again'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Nothing is added until you say so, so this is safe to leave sitting here.
      </p>

      <ul className="mt-3 space-y-3">
        {due.map((rule) =>
          rule.dueDates.map((on) => {
            const key = `${rule.id}:${on}`;
            const working = busy === key;
            return (
              <li key={key} className="rounded-xl border border-line bg-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{rule.description}</span>
                  <span className="font-display tabular-nums">{Money.fromCents(rule.amountCents).format()}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {prettyDate(on)} · {nameOf(rule.payerId)} pays, split{' '}
                  {rule.participantIds.length === members.length
                    ? 'with everyone'
                    : `${rule.participantIds.length} ways`}
                </p>
                {rule.truncated && (
                  <p className="mt-1 text-xs text-muted">
                    Older ones than this were left out. Add or skip these and the rest catch up.
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run(key, () => onSkip(rule.id, on), 'tick')}
                    className="flex-1 rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50"
                  >
                    Not this time
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run(key, () => onAccept(rule.id, on), 'add')}
                    className="flex-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
                  >
                    {working ? 'Adding...' : 'Add it'}
                  </button>
                </div>
              </li>
            );
          }),
        )}
      </ul>
    </section>
  );
}

/** The quiet list of what repeats, so a rule is never a thing you cannot find again. */
export function RecurringList({
  rules,
  members,
  onSetActive,
}: {
  rules: RecurringRule[];
  members: GroupMember[];
  onSetActive: (ruleId: string, active: boolean) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  if (rules.length === 0) return null;
  const nameOf = (id: string): string => members.find((m) => m.userId === id)?.displayName ?? 'Someone';

  return (
    <section aria-labelledby="recurring-list-heading" className="rounded-2xl border border-line bg-card p-4">
      <h2 id="recurring-list-heading" className="font-display text-base font-semibold">
        Repeats
      </h2>
      <ul className="mt-3 space-y-2">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
            <div className="min-w-0">
              <p className={`truncate font-medium ${rule.active ? '' : 'text-muted line-through'}`}>
                {rule.description}
              </p>
              <p className="text-sm text-muted">
                {Money.fromCents(rule.amountCents).format()} {rule.cadenceLabel}, {nameOf(rule.payerId)} pays
                {rule.active && ` · next ${prettyDate(rule.nextOn)}`}
              </p>
            </div>
            <button
              type="button"
              disabled={busy === rule.id}
              onClick={() => {
                setBusy(rule.id);
                void onSetActive(rule.id, !rule.active).finally(() => setBusy(null));
              }}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition hover:text-ink disabled:opacity-50"
            >
              {rule.active ? 'Stop' : 'Start again'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
