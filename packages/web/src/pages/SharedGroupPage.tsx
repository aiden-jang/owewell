import { usePageTitle } from '../hooks/usePageTitle';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatMoney as fmt, type MoneyFormatter } from '@owewell/shared';
import type { SharedGroupSummary } from '@owewell/core';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';
import { groupsApi } from '../lib/groups';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Avatar } from '../components/Avatar';
import { BrandMark } from '../components/BrandMark';
import { Icon } from '../components/Icon';
import { SharedSpendBreakdown } from '../components/SharedSpendBreakdown';
import { useToast } from '../components/Toast';
import { useAsyncScope } from '../lib/useAsyncScope';
import { SessionNotice } from '../components/SessionNotice';

function balanceLabel(
  netCents: number,
  hasActivity: boolean,
  fmt: MoneyFormatter,
): { text: string; tone: string } {
  // With no expenses yet, nobody is settled OR owing — there's just nothing to settle.
  if (!hasActivity) return { text: '', tone: 'text-muted' };
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-pos' }
    : { text: `owes ${amount}`, tone: 'text-neg' };
}

export function SharedGroupPage(): ReactNode {
  const { token } = useParams<{ token: string }>();
  return <SharedGroupView key={token} token={token} />;
}

function SharedGroupView({ token }: { token: string | undefined }): ReactNode {
  const { user, login, loading, sessionError } = useAuth();
  const { begin, captureScope } = useAsyncScope();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'failed'>('loading');
  const [summary, setSummary] = useState<SharedGroupSummary | null>(null);
  usePageTitle(status === 'ready' && summary ? summary.groupName : 'Shared group');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [expiredSeat, setExpiredSeat] = useState<string | null>(null);
  const autoClaimed = useRef(false);
  const loadSummaryAfterClaim = useRef<(() => void) | null>(null);

  const signInForSeat = useCallback(
    (seatId: string) => {
      const returnTo = new URL(`/s/${encodeURIComponent(token ?? '')}`, window.location.origin);
      returnTo.searchParams.set('claim', seatId);
      login(returnTo.href);
    },
    [login, token],
  );

  // Keep the requested seat until the claim completes or the server rules it out.
  const claimSeat = useCallback(
    async (seatId: string): Promise<void> => {
      if (!token || loading || sessionError) return;
      if (!user || expiredSeat) {
        signInForSeat(seatId);
        return;
      }
      setClaiming(seatId);
      const current = captureScope();
      try {
        const { groupId } = await groupsApi.claimSeat(token, seatId);
        if (current()) navigate(`/groups/${groupId}`);
      } catch (err) {
        if (!current()) return;
        if (err instanceof ApiError && err.status === 401) {
          setExpiredSeat(seatId);
        } else {
          toast.error(err instanceof Error ? err.message : 'Could not claim that spot.');
          if (err instanceof ApiError && [400, 403, 404, 409].includes(err.status)) {
            setSearchParams(
              (params) => {
                const next = new URLSearchParams(params);
                next.delete('claim');
                return next;
              },
              { replace: true },
            );
            loadSummaryAfterClaim.current?.();
          }
        }
        setClaiming(null);
      }
    },
    [
      captureScope,
      expiredSeat,
      loading,
      navigate,
      sessionError,
      setSearchParams,
      signInForSeat,
      toast,
      token,
      user,
    ],
  );

  const viewerIsMember = !!user && !!summary && summary.members.some((m) => m.userId === user.id);
  const hasOpenSeats = !!summary && summary.members.some((m) => m.isPlaceholder);

  const loadSummary = useCallback((): void => {
    const current = begin();
    if (!token) {
      setStatus('notfound');
      return;
    }
    setStatus('loading');
    groupsApi
      .sharedSummary(token)
      .then((s) => {
        if (!current()) return;
        setSummary(s);
        setStatus('ready');
      })
      .catch((err) => {
        if (!current()) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setStatus('notfound');
        else setStatus('failed');
      });
  }, [begin, token]);

  loadSummaryAfterClaim.current = loadSummary;
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Returning from sign-in with ?claim=<seat>: finish the claim now and head to the group.
  // Already-members go straight in. Within this page, a failed automatic claim can be retried by hand.
  useEffect(() => {
    const seatId = searchParams.get('claim');
    if (loading || sessionError || status !== 'ready' || !summary || !user || !seatId || autoClaimed.current)
      return;
    autoClaimed.current = true;
    if (viewerIsMember) navigate(`/groups/${summary.groupId}`);
    else void claimSeat(seatId);
  }, [claimSeat, loading, navigate, searchParams, sessionError, status, summary, user, viewerIsMember]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="workspace-width mx-auto flex items-center justify-between px-4 py-2">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 font-display text-lg font-semibold tracking-tight"
          >
            <BrandMark /> owewell
          </Link>
          <span className="text-xs text-muted">shared with you</span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="workspace-width mx-auto w-full flex-1 animate-rise px-4 py-8">
        {status === 'loading' && (
          <div aria-busy="true" aria-label="Loading the tab">
            <Skeleton className="h-10 w-44" />
            <Skeleton className="mt-2 h-5 w-32" />
            <div className="ledger-grid mt-6">
              <div className="ledger-summary">
                <Skeleton className="h-32 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
              </div>
              <Skeleton className="h-56 rounded-2xl" />
            </div>
          </div>
        )}

        {status === 'notfound' && (
          <EmptyState
            tone="problem"
            icon="link"
            titleAs="h1"
            title="This link isn't valid."
            body="This link was turned off or the group was removed. Ask the person who shared it for a new link."
          />
        )}

        {status === 'failed' && (
          <EmptyState
            tone="problem"
            icon="link"
            titleAs="h1"
            title="Couldn't load this tab."
            body="Check your connection and try opening the same tab again."
            action={
              <button
                type="button"
                onClick={loadSummary}
                className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98]"
              >
                <Icon name="arrow-up-right" size={16} /> Try again
              </button>
            }
          />
        )}

        {status === 'ready' && summary && (
          <>
            <h1 className="break-words font-display text-4xl font-semibold tracking-tight">
              {summary.groupName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {summary.memberCount} {summary.memberCount === 1 ? 'person' : 'people'} · Read-only tab
            </p>

            <div className="ledger-grid mt-6">
              <div className="ledger-summary">
                <div className="surface rounded-2xl p-5">
                  <p className="text-sm font-medium text-muted">Spent together</p>
                  <p
                    className="mt-1 font-display text-4xl font-semibold tracking-tight"
                    style={
                      fmt(summary.totalSpentCents).length > 9
                        ? {
                            fontSize: `clamp(1.5rem, ${90 / fmt(summary.totalSpentCents).length}vw, 3.75rem)`,
                          }
                        : undefined
                    }
                  >
                    {fmt(summary.totalSpentCents)}
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    {fmt(summary.perPersonCents)} avg/person
                    {summary.totalSettledCents > 0 && ` · ${fmt(summary.totalSettledCents)} settled so far`}
                  </p>
                </div>

                <section className="surface rounded-2xl p-4">
                  <h2 className="text-sm font-semibold text-ink">Who owes who</h2>
                  {summary.suggested.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      {summary.totalSpentCents > 0 || summary.totalSettledCents > 0
                        ? 'All settled up. Nobody owes anybody.'
                        : 'No expenses yet.'}
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {summary.suggested.map((p, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <Avatar name={p.fromName} size="sm" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="tnum font-semibold">{fmt(p.amountCents)}</span>
                            <span className="text-xs text-muted [overflow-wrap:anywhere]">
                              <span className="font-medium text-ink">{p.fromName}</span> pays{' '}
                              <span className="font-medium text-ink">{p.toName}</span>
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              <div className="min-w-0">
                <section>
                  <h2 className="font-display text-lg font-semibold">Members</h2>
                  {hasOpenSeats && !viewerIsMember && <SessionNotice />}
                  {!viewerIsMember && (
                    <p className="mt-2 text-xs text-muted">
                      Choose “This is me” beside your name to connect that spot and its balances to your
                      account.
                    </p>
                  )}
                  {expiredSeat && (
                    <p role="status" className="mt-3 text-sm text-muted">
                      Your sign-in expired.{' '}
                      <button
                        type="button"
                        onClick={() => signInForSeat(expiredSeat)}
                        className="tap font-medium text-accent underline underline-offset-4"
                      >
                        Sign in again to claim your spot
                      </button>
                    </p>
                  )}
                  <ul className="mt-3 space-y-2">
                    {summary.members.map((m, i) => {
                      const label = balanceLabel(
                        m.netCents,
                        summary.totalSpentCents > 0 || summary.totalSettledCents > 0,
                        fmt,
                      );
                      const claimable = m.isPlaceholder && !viewerIsMember;
                      return (
                        <li
                          key={i}
                          className="surface flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-3">
                            <Avatar name={m.displayName} />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="font-medium [overflow-wrap:anywhere]">{m.displayName}</span>
                              {label.text && (
                                <span
                                  className={`tnum text-xs font-medium [overflow-wrap:anywhere] ${label.tone}`}
                                >
                                  {label.text}
                                </span>
                              )}
                            </span>
                          </span>
                          {claimable && (
                            <button
                              type="button"
                              onClick={() => void claimSeat(m.userId)}
                              disabled={claiming !== null || loading || sessionError}
                              className="tap shrink-0 rounded-full border border-accent px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft disabled:opacity-60"
                            >
                              {claiming === m.userId ? 'Claiming…' : 'This is me'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <SharedSpendBreakdown breakdown={summary.breakdown} total={summary.totalSpentCents} />

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
                    Choose only your own name. If it’s missing, ask a member to add you.
                  </p>
                ) : (
                  <p className="mt-8 text-sm text-muted">
                    Viewing only. Ask a member to add you to edit this group.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
