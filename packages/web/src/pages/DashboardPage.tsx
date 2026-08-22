import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CURRENCIES, currencyFormatter, DEFAULT_CURRENCY, type MoneyFormatter } from '@owewell/shared';
import { CurrencyProvider } from '../lib/currency';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MoneyText } from '../components/MoneyText';
import { SkeletonList } from '../components/Skeleton';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';
import { timeAgo } from '../lib/relativeTime.js';

function perGroupLabel(
  netCents: number,
  hasExpenses: boolean,
  groupHasUnsettled: boolean,
  fmt: MoneyFormatter,
): { text: string; className: string } {
  // No expenses yet isn't "settled" — there's just nothing owed. Show a neutral "no expenses".
  if (!hasExpenses) return { text: 'no expenses', className: 'text-faint' };
  // Net zero for the viewer doesn't mean the group is done: others may still owe each other.
  // "settled up" claims the whole group is clear; "you're square" is just the viewer's balance.
  if (netCents === 0)
    return { text: groupHasUnsettled ? "you're square" : 'settled up', className: 'text-muted' };
  const amount = fmt(Math.abs(netCents));
  return netCents > 0
    ? { text: `+${amount}`, className: 'text-pos' }
    : { text: `-${amount}`, className: 'text-neg' };
}

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  // Distinguish a failed load from a genuinely empty account: null = loading, [] = empty,
  // loadError = the fetch failed (show a retry, not the cheerful "no groups" state).
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  // Sticky across the session would be wrong: most people have one currency and one odd trip.
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => loadPendingSplit());
  const [savingPending, setSavingPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Set once the name field has been touched, so the "needs a name" hint appears on demand and not
  // as a scolding the instant the form opens.
  const [nameTouched, setNameTouched] = useState(false);

  const toggleSelected = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = (): void => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Select mode and the create form are mutually exclusive. Opening one closes the other: they used to
  // coexist, which left the name field sitting under the selection UI while the footer bar pushed the
  // page around, and select mode hides the New button so there was no way back to it.
  const openCreate = (): void => {
    setSelectMode(false);
    setSelected(new Set());
    setNameTouched(false);
    setError(null);
    setCreatingOpen(true);
  };

  const closeCreate = (): void => {
    setCreatingOpen(false);
    setName('');
    setNameTouched(false);
    setError(null);
  };

  const enterSelect = (): void => {
    closeCreate();
    setSelectMode(true);
  };

  async function onBulkArchive(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => groupsApi.setArchived(id, true)));
      setGroups((prev) => (prev ?? []).map((g) => (selected.has(g.id) ? { ...g, archived: true } : g)));
      toast.success(`Archived ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not archive some of those.');
    } finally {
      setBulkBusy(false);
    }
    exitSelect();
  }

  async function onBulkDelete(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}?`,
      body: 'This permanently removes them for everyone. It can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => groupsApi.remove(id)));
      setGroups((prev) => (prev ?? []).filter((g) => !selected.has(g.id)));
      toast.success(`Deleted ${ids.length} ${ids.length === 1 ? 'group' : 'groups'}.`);
    } catch {
      toast.error('Could not delete some of those.');
    } finally {
      setBulkBusy(false);
    }
    exitSelect();
  }

  const loadGroups = useCallback(() => {
    setLoadError(false);
    setGroups(null);
    groupsApi
      .list()
      .then(setGroups)
      .catch(() => {
        setLoadError(true);
        toast.error('Could not load your groups.');
      });
  }, [toast]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Archived groups drop out of the overall totals and the main list.
  /*
   * Totals per currency, never across them.
   *
   * Groups each count in their own currency, so one summed figure would be euros added to dollars
   * presented as a number somebody might act on. Almost everybody has one currency and sees exactly
   * what they saw before; anybody with two gets two lines rather than one wrong one.
   */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { owed: number; owe: number; net: number }>();
    for (const g of (groups ?? []).filter((x) => !x.archived)) {
      const t = byCurrency.get(g.currency) ?? { owed: 0, owe: 0, net: 0 };
      if (g.netCents > 0) t.owed += g.netCents;
      if (g.netCents < 0) t.owe -= g.netCents;
      t.net = t.owed - t.owe;
      byCurrency.set(g.currency, t);
    }
    const codes = [...byCurrency.keys()].sort();
    const only = codes.length === 1 ? byCurrency.get(codes[0]!)! : null;
    return {
      byCurrency,
      codes,
      mixed: codes.length > 1,
      owed: only?.owed ?? 0,
      owe: only?.owe ?? 0,
      net: only?.net ?? 0,
      fmt: currencyFormatter(codes.length === 1 ? codes[0]! : DEFAULT_CURRENCY),
    };
  }, [groups]);

  async function savePending(): Promise<void> {
    if (!pending) return;
    setSavingPending(true);
    try {
      const { groupId } = await quickSplitApi.save(pending);
      clearPendingSplit();
      setPending(null);
      navigate(`/groups/${groupId}`);
    } catch {
      setSavingPending(false);
      toast.error('Could not save that split. Give it another go.');
    }
  }

  function dismissPending(): void {
    clearPendingSplit();
    setPending(null);
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    // Used to return silently, so pressing Create with an empty field looked like the app had frozen.
    if (!name.trim()) {
      setNameTouched(true);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const group = await groupsApi.create(name.trim(), currency);
      setGroups((prev) => [
        {
          id: group.id,
          name: group.name,
          createdAt: group.createdAt,
          archived: false,
          memberCount: group.members.length,
          netCents: 0,
          totalUnsettledCents: 0,
          totalSpentCents: 0,
          lastActivityAt: group.createdAt,
          isOwner: true,
          currency: group.currency,
        },
        ...(prev ?? []),
      ]);
      closeCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that group.');
    } finally {
      setCreating(false);
    }
  }

  const settled = !totals.mixed && totals.net === 0;
  const owed = totals.net > 0;
  const activeGroups = (groups ?? []).filter((g) => !g.archived);
  const archivedGroups = (groups ?? []).filter((g) => g.archived);
  // "All settled" only makes sense once there's been spending somewhere; a set of brand-new,
  // expense-free groups nets to zero but isn't "settled".
  const hasAnySpend = activeGroups.some((g) => g.totalSpentCents > 0);
  // You can net to zero yourself while other members still owe each other. In that case say
  // "You're square" (your balance), not "All settled" (which claims the whole group is done).
  const othersStillOwe = activeGroups.some((g) => g.totalUnsettledCents > 0);
  const selectedGroups = (groups ?? []).filter((g) => selected.has(g.id));
  const allOwned = selectedGroups.length > 0 && selectedGroups.every((g) => g.isOwner);

  // `selectable` rows become tap-to-select in select mode; archived rows stay plain links.
  const groupRow = (group: GroupSummary, selectable = true): ReactNode => {
    const fmt = currencyFormatter(group.currency);
    const label = perGroupLabel(group.netCents, group.totalSpentCents > 0, group.totalUnsettledCents > 0, fmt);
    // Last activity, not creation date: it answers "is this still going on", which is the only date
    // question a dashboard row raises. A group with no expenses yet says when it was started.
    const activity = group.totalSpentCents > 0 ? timeAgo(group.lastActivityAt) : `started ${timeAgo(group.createdAt)}`;
    const isSel = selected.has(group.id);
    const selecting = selectMode && selectable;
    const inner = (
      <>
        <span className="relative shrink-0">
          <Avatar name={group.name} />
          {selecting && isSel && (
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-white ring-2 ring-canvas">
              <Icon name="check" size={12} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{group.name}</span>
          {/* Truncated like the group name above it: on a narrow phone "3 people · 23 hours ago"
              wrapped to two lines and shoved the amount column out of alignment. */}
          <span className="block truncate text-sm text-muted">
            {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
            {activity && <span className="text-faint"> &middot; {activity}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className={`tnum text-sm font-semibold ${label.className}`}>{label.text}</span>
          {group.totalUnsettledCents > 0 && (
            <span className="tnum whitespace-nowrap text-xs text-faint">
              {fmt(group.totalUnsettledCents)} unsettled
            </span>
          )}
        </span>
        {/*
          The chevron's SLOT is always here, even in select mode. Hiding the icon outright reflowed
          every row, so entering select mode made all the names and dates jump sideways — the most
          noticeable thing on the screen on a phone.
        */}
        <span className="grid w-[18px] shrink-0 place-items-center">
          {!selecting && <Icon name="chevron-right" size={18} className="text-faint" />}
        </span>
      </>
    );
    const cls = `row-interactive surface flex items-center gap-4 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/20 ${
      group.archived ? 'opacity-60' : ''
    } ${selecting && isSel ? 'ring-1 ring-accent' : ''}`;
    return (
      <li key={group.id}>
        {selecting ? (
          <button
            type="button"
            onClick={() => toggleSelected(group.id)}
            aria-pressed={isSel}
            className={`w-full text-left ${cls}`}
          >
            {inner}
          </button>
        ) : (
          <Link to={`/groups/${group.id}`} className={cls}>
            {inner}
          </Link>
        )}
      </li>
    );
  };

  return (
    <div className="flex-1">
      <AppHeader />
      <main className={`mx-auto w-full max-w-2xl animate-rise px-4 py-8 ${selectMode ? 'pb-28' : ''}`}>
        {pending && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="sparkles" size={16} className="text-accent" />
              You left a split lying around:{' '}
              <span className="font-medium">
                {pending.items[0]?.description || 'Quick split'}
                {pending.items.length > 1 ? ` +${pending.items.length - 1} more` : ''}
              </span>
              .
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void savePending()}
                disabled={savingPending}
                className="btn-gradient rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
              >
                {savingPending ? 'Saving...' : 'Save it'}
              </button>
              <button
                type="button"
                onClick={dismissPending}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Nothing to total before there is a group: an account on its first day was being shown a
            $0.00 the size of a headline, above an empty state that already says the same thing. */}
        {activeGroups.length > 0 && (
        <section className="glass rounded-3xl p-6 sm:p-7">
          <p className="text-sm font-medium text-muted">
            {totals.mixed
              ? 'Across all your groups'
              : settled
                ? 'Across all your groups'
                : owed
                  ? "You're owed, overall"
                  : 'You owe, overall'}
          </p>
          <p
            className={`mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl ${
              settled ? 'text-ink' : owed ? 'text-gradient' : 'text-neg'
            }`}
          >
            {totals.mixed ? (
              <span className="flex flex-col gap-1 text-3xl sm:text-4xl">
                {totals.codes.map((code) => {
                  const t = totals.byCurrency.get(code)!;
                  const f = currencyFormatter(code);
                  return (
                    <span key={code} className={t.net > 0 ? 'text-pos' : t.net < 0 ? 'text-neg' : 'text-ink'}>
                      {t.net === 0 ? `${code} square` : `${t.net > 0 ? '+' : '−'}${f(Math.abs(t.net))}`}
                    </span>
                  );
                })}
              </span>
            ) : settled && hasAnySpend ? (
              othersStillOwe ? (
                "You're square"
              ) : (
                'All settled'
              )
            ) : (
              <CurrencyProvider code={totals.codes[0] ?? DEFAULT_CURRENCY}>
                <MoneyText cents={Math.abs(totals.net)} />
              </CurrencyProvider>
            )}
          </p>
          {!totals.mixed && (totals.owed > 0 || totals.owe > 0) && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {totals.owed > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-pos" />
                  <span className="text-muted">owed to you</span>
                  <span className="tnum font-medium text-pos">{totals.fmt(totals.owed)}</span>
                </span>
              )}
              {totals.owe > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-neg" />
                  <span className="text-muted">you owe</span>
                  <span className="tnum font-medium text-neg">{totals.fmt(totals.owe)}</span>
                </span>
              )}
            </div>
          )}
        </section>
        )}

        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">Your groups</h2>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <button
                type="button"
                onClick={exitSelect}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
              >
                Cancel
              </button>
            ) : (
              <>
                {activeGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={enterSelect}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                  >
                    <Icon name="check" size={16} /> Select
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (creatingOpen ? closeCreate() : openCreate())}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
                >
                  <Icon name="plus" size={16} /> New
                </button>
              </>
            )}
          </div>
        </div>

        {creatingOpen && (
          <form onSubmit={(e) => void onCreate(e)} className="mt-3">
            <div className="flex gap-2">
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                onKeyDown={(e) => e.key === 'Escape' && closeCreate()}
                aria-invalid={nameTouched && !name.trim()}
                aria-describedby="group-name-hint"
                placeholder="Tahoe trip, apartment 4B, book club..."
                className={`flex-1 rounded-xl border bg-field px-3.5 py-2.5 outline-none transition focus:ring-2 focus:ring-accent/20 ${
                  nameTouched && !name.trim() ? 'border-neg' : 'border-line focus:border-accent'
                }`}
              />
              {/* Right here rather than buried in settings: it is a two-second choice when the group
                  is a trip, and an annoying correction once the first expense is in. */}
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                aria-label="Currency"
                className="rounded-xl border border-line bg-field px-2.5 py-2.5 text-sm outline-none transition focus:border-accent"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="btn-gradient rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98] disabled:opacity-60"
              >
                {creating ? 'Adding...' : 'Create'}
              </button>
            </div>
            <p
              id="group-name-hint"
              className={`mt-1.5 text-sm ${nameTouched && !name.trim() ? 'font-medium text-neg' : 'text-faint'}`}
            >
              {nameTouched && !name.trim() ? 'Give the group a name to create it.' : 'Name it after the trip, the flat, or the people.'}
            </p>
          </form>
        )}
        {error && <p className="mt-2 text-sm font-medium text-neg">{error}</p>}

        <div className="mt-4">
          {loadError ? (
            <div className="rounded-3xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="users" size={22} />
              </div>
              <p className="mt-4 text-lg font-medium">Couldn&apos;t load your groups.</p>
              <p className="mt-1 text-sm text-muted">Probably a hiccup on our end, not you.</p>
              <Button variant="secondary" onClick={loadGroups} className="mt-4">
                Try again
              </Button>
            </div>
          ) : groups === null ? (
            <SkeletonList rows={3} />
          ) : activeGroups.length === 0 && archivedGroups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="users" size={22} />
              </div>
              <p className="mt-4 text-lg font-medium">No groups yet. The calm before the tab.</p>
              <p className="mt-1 text-sm text-muted">
                Make one to start splitting, or{' '}
                <Link to="/split" className="font-medium text-accent hover:underline">
                  split a bill
                </Link>{' '}
                without an account.
              </p>
            </div>
          ) : (
            <>
              {activeGroups.length > 0 ? (
                <ul className="space-y-2.5">{activeGroups.map((g) => groupRow(g))}</ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                  No active groups. Your archived ones are below.
                </p>
              )}
              {archivedGroups.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink"
                  >
                    <Icon name="archive" size={15} /> Archived ({archivedGroups.length})
                    <Icon
                      name="chevron-right"
                      size={15}
                      className={`transition ${showArchived ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {showArchived && (
                    <ul className="mt-2.5 space-y-2.5">{archivedGroups.map((g) => groupRow(g, false))}</ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {selectMode && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onBulkArchive()}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 py-2 text-sm font-medium transition hover:border-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="archive" size={15} /> Archive
              </button>
              <button
                type="button"
                onClick={() => void onBulkDelete()}
                disabled={!allOwned || bulkBusy}
                title={allOwned ? undefined : 'You can only delete groups you own'}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
