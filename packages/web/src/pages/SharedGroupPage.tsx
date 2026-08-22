import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { currencyFormatter, DEFAULT_CURRENCY, type MoneyFormatter } from '@owewell/shared';
import { CurrencyProvider } from '../lib/currency';
import { categoryMeta, type SharedGroupSummary } from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { groupsApi } from '../lib/groups';
import { Avatar } from '../components/Avatar';
import { BrandMark } from '../components/BrandMark';
import { Icon } from '../components/Icon';
import { SpendDonut } from '../components/SpendDonut';
import { useToast } from '../components/Toast';

function balanceLabel(netCents: number, hasActivity: boolean, fmt: MoneyFormatter): { text: string; tone: string } {
  // With no expenses yet, nobody is settled OR owing — there's just nothing to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

/**
 * Public, read-only view of a group behind a share token. Anyone with the link sees the
 * summary. A signed-in visitor can claim an unclaimed seat (placeholder) that's theirs, which
 * makes them a real member and opens the editable group. Members just open it directly.
 */
export function SharedGroupPage(): ReactNode {
  const { token } = useParams<{ token: string }>();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'failed'>('loading');
  const [summary, setSummary] = useState<SharedGroupSummary | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [breakdownView, setBreakdownView] = useState<'bars' | 'donut'>('bars');
  const autoClaimed = useRef(false);

  // Claim a seat. Signed out → sign in and come back with ?claim=<seat> so we finish
  // automatically. Signed in → merge the seat and drop into the now-editable group.
  async function claimSeat(seatId: string): Promise<void> {
    if (!token) return;
    if (!user) {
      login(`${window.location.origin}/s/${token}?claim=${seatId}`);
      return;
    }
    setClaiming(seatId);
    try {
      const { groupId } = await groupsApi.claimSeat(token, seatId);
      navigate(`/groups/${groupId}`);
    } catch (err) {
      // Surfaces the server's reason, e.g. "You're already in this group." for a member, or a
      // taken/invalid seat.
      toast.error(err instanceof Error ? err.message : 'Could not claim that spot.');
      setClaiming(null);
    }
  }

  const viewerIsMember = !!user && !!summary && summary.members.some((m) => m.userId === user.id);
  const hasOpenSeats = !!summary && summary.members.some((m) => m.isPlaceholder);

  function loadSummary(): void {
    if (!token) {
      setStatus('notfound');
      return;
    }
    setStatus('loading');
    groupsApi
      .sharedSummary(token)
      .then((s) => {
        setSummary(s);
        setStatus('ready');
      })
      .catch((err) => {
        // A real dead/disabled link is a 404/403; anything else (offline, 5xx) is transient and
        // shouldn't tell an invited person their invite is gone. Offer a retry instead.
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setStatus('notfound');
        else setStatus('failed');
      });
  }

  useEffect(() => {
    loadSummary();
  }, [token]);

  // Returning from sign-in with ?claim=<seat>: finish the claim now and head to the group.
  // Already-members just go straight in. Runs once; the param is cleared so a refresh won't retry.
  useEffect(() => {
    const seatId = searchParams.get('claim');
    if (status !== 'ready' || !summary || !user || !seatId || autoClaimed.current) return;
    autoClaimed.current = true;
    setSearchParams({}, { replace: true });
    if (viewerIsMember) navigate(`/groups/${summary.groupId}`);
    else void claimSeat(seatId);
  }, [status, summary, user, searchParams, viewerIsMember]);

  // The summary carries its group's currency; before it loads there is nothing priced to get wrong.
  const fmt = currencyFormatter(summary?.currency ?? DEFAULT_CURRENCY);

  return (
    <CurrencyProvider code={summary?.currency ?? DEFAULT_CURRENCY}>
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
            <BrandMark /> owewell
          </Link>
          <span className="text-xs text-muted">shared with you</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 animate-rise px-4 py-8">
        {status === 'loading' && <p className="text-center text-sm text-muted">Loading the tab...</p>}

        {status === 'notfound' && (
          <div className="rounded-3xl border border-dashed border-line p-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
              <Icon name="link" size={22} />
            </div>
            <p className="mt-4 text-lg font-medium">This link isn&rsquo;t valid.</p>
            <p className="mt-1 text-sm text-muted">Someone turned it off, or the group&rsquo;s long gone.</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="rounded-3xl border border-dashed border-line p-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
              <Icon name="link" size={22} />
            </div>
            <p className="mt-4 text-lg font-medium">Couldn&rsquo;t load this tab.</p>
            <p className="mt-1 text-sm text-muted">Might be your signal. Might be us.</p>
            <button
              type="button"
              onClick={loadSummary}
              className="btn-gradient mt-5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98]"
            >
              <Icon name="arrow-up-right" size={16} /> Try again
            </button>
          </div>
        )}

        {status === 'ready' && summary && (
          <>
            {!viewerIsMember && (
              <p className="text-sm font-medium text-accent">
                {hasOpenSeats ? "You've been invited" : 'Shared with you'}
              </p>
            )}
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{summary.groupName}</h1>
            <p className="mt-1 text-sm text-muted">
              {summary.memberCount} {summary.memberCount === 1 ? 'person' : 'people'}
            </p>

            <div className="glass mt-5 rounded-3xl p-6 sm:p-7">
              <p className="text-sm font-medium text-muted">Spent together</p>
              <p className="mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
                {fmt(summary.totalSpentCents)}
              </p>
              <p className="mt-2 text-xs text-faint">
                {fmt(summary.perPersonCents)} avg/person
                {summary.totalSettledCents > 0 &&
                  ` · ${fmt(summary.totalSettledCents)} settled so far`}
              </p>
            </div>

            <section className="mt-6 rounded-2xl border border-accent/25 bg-accent-soft p-4">
              <h2 className="text-sm font-semibold text-accent">Who owes who</h2>
              {summary.suggested.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  {summary.totalSpentCents > 0 || summary.totalSettledCents > 0
                    ? 'All settled up. Nobody owes anybody.'
                    : 'No expenses yet.'}
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {summary.suggested.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Avatar name={p.fromName} size="sm" />
                        <span>
                          <span className="font-medium">{p.fromName}</span>
                          <span className="text-muted"> pays </span>
                          <span className="font-medium">{p.toName}</span>
                        </span>
                      </span>
                      <span className="tnum font-medium">{fmt(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-medium text-muted">Members</h2>
              <ul className="mt-3 space-y-2">
                {summary.members.map((m, i) => {
                  const label = balanceLabel(
                    m.netCents,
                    summary.totalSpentCents > 0 || summary.totalSettledCents > 0,
                    fmt,
                  );
                  const claimable = m.isPlaceholder && !viewerIsMember;
                  return (
                    <li key={i} className="surface flex items-center justify-between gap-3 rounded-xl px-4 py-3">
                      <span className="flex min-w-0 items-center gap-3 font-medium">
                        <Avatar name={m.displayName} />
                        <span className="truncate">{m.displayName}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {label.text && (
                          <span className={`tnum text-sm font-medium ${label.tone}`}>{label.text}</span>
                        )}
                        {claimable && (
                          <button
                            type="button"
                            onClick={() => void claimSeat(m.userId)}
                            disabled={claiming === m.userId}
                            className="rounded-full border border-accent px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft disabled:opacity-60"
                          >
                            {claiming === m.userId ? 'Claiming...' : 'This is me'}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {summary.breakdown.length > 1 && (
              <section className="mt-8">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-muted">Where it went</h2>
                  <div className="inline-flex rounded-full border border-line p-0.5 text-xs">
                    {(['bars', 'donut'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setBreakdownView(v)}
                        aria-pressed={breakdownView === v}
                        className={`rounded-full px-2.5 py-0.5 font-medium capitalize transition ${
                          breakdownView === v ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                {breakdownView === 'donut' ? (
                  <SpendDonut
                    data={[...summary.breakdown]
                      .sort((a, b) => b.cents - a.cents)
                      .map(({ category, cents }) => ({ meta: categoryMeta(category), cents }))}
                    total={summary.totalSpentCents}
                  />
                ) : (
                <ul className="mt-3 space-y-2.5">
                  {summary.breakdown.map(({ category, cents }) => {
                    const meta = categoryMeta(category);
                    return (
                      <li key={category} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 truncate text-sm">
                          <span aria-hidden className="mr-1.5">
                            {meta.emoji}
                          </span>
                          {meta.label}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{
                              width: `${Math.max(3, Math.round((cents / summary.totalSpentCents) * 100))}%`,
                            }}
                          />
                        </span>
                        <span className="tnum w-20 shrink-0 text-right text-sm text-muted">
                          {fmt(cents)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                )}
              </section>
            )}

            {viewerIsMember ? (
              <button
                type="button"
                onClick={() => navigate(`/groups/${summary.groupId}`)}
                className="btn-gradient mt-8 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98]"
              >
                <Icon name="arrow-up-right" size={16} /> Open in owewell
              </button>
            ) : hasOpenSeats ? (
              <p className="mt-8 text-sm text-muted">
                See your name above? Tap <span className="font-medium text-accent">This is me</span> to claim
                your spot and edit{user ? '.' : ' (you’ll sign in first).'}
              </p>
            ) : (
              <p className="mt-8 text-sm text-muted">
                Viewing only. Ask a member to add you to edit this group.
              </p>
            )}
          </>
        )}
      </main>
    </div>
    </CurrencyProvider>
  );
}
