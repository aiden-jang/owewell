import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money } from '@aidenjang/shared';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MoneyText } from '../components/MoneyText';
import { SkeletonList } from '../components/Skeleton';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';

function perGroupLabel(netCents: number): { text: string; className: string } {
  if (netCents === 0) return { text: 'settled', className: 'text-muted' };
  const amount = Money.fromCents(Math.abs(netCents)).format();
  return netCents > 0
    ? { text: `+${amount}`, className: 'text-pos' }
    : { text: `-${amount}`, className: 'text-neg' };
}

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [name, setName] = useState('');
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => loadPendingSplit());
  const [savingPending, setSavingPending] = useState(false);

  useEffect(() => {
    groupsApi
      .list()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  const totals = useMemo(() => {
    const list = groups ?? [];
    const owed = list.filter((g) => g.netCents > 0).reduce((s, g) => s + g.netCents, 0);
    const owe = list.filter((g) => g.netCents < 0).reduce((s, g) => s - g.netCents, 0);
    return { owed, owe, net: owed - owe };
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
    }
  }

  function dismissPending(): void {
    clearPendingSplit();
    setPending(null);
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const group = await groupsApi.create(name.trim());
      setGroups((prev) => [
        {
          id: group.id,
          name: group.name,
          createdAt: group.createdAt,
          memberCount: group.members.length,
          netCents: 0,
        },
        ...(prev ?? []),
      ]);
      setName('');
      setCreatingOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that group.');
    } finally {
      setCreating(false);
    }
  }

  const settled = totals.net === 0;
  const owed = totals.net > 0;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-2xl animate-rise px-4 py-8">
        {pending && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="sparkles" size={16} className="text-accent" />
              You left a split lying around: <span className="font-medium">{pending.description}</span>.
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

        <section className="glass rounded-3xl p-6 sm:p-7">
          <p className="text-sm font-medium text-muted">
            {settled ? 'Across all your groups' : owed ? "You're owed, overall" : 'You owe, overall'}
          </p>
          <p
            className={`mt-1 font-display text-5xl font-extrabold tracking-tight sm:text-6xl ${
              settled ? 'text-ink' : owed ? 'text-gradient' : 'text-neg'
            }`}
          >
            {settled && (groups?.length ?? 0) > 0 ? (
              'All settled'
            ) : (
              <MoneyText cents={Math.abs(totals.net)} />
            )}
          </p>
          {(totals.owed > 0 || totals.owe > 0) && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-pos" />
                <span className="text-muted">owed to you</span>
                <span className="tnum font-medium text-pos">
                  {Money.fromCents(totals.owed).format()}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/40 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-neg" />
                <span className="text-muted">you owe</span>
                <span className="tnum font-medium text-neg">
                  {Money.fromCents(totals.owe).format()}
                </span>
              </span>
            </div>
          )}
        </section>

        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">Your groups</h2>
          <button
            type="button"
            onClick={() => setCreatingOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-3.5 py-1.5 text-sm font-medium transition hover:border-accent active:scale-[0.98]"
          >
            <Icon name="plus" size={16} /> New
          </button>
        </div>

        {creatingOpen && (
          <form onSubmit={(e) => void onCreate(e)} className="mt-3 flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tahoe trip, apartment 4B, book club..."
              className="flex-1 rounded-xl border border-line bg-field px-3.5 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="submit"
              disabled={creating}
              className="btn-gradient rounded-full px-5 py-2.5 font-semibold transition active:scale-[0.98] disabled:opacity-60"
            >
              {creating ? 'Adding...' : 'Create'}
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-sm font-medium text-neg">{error}</p>}

        <div className="mt-4">
          {groups === null ? (
            <SkeletonList rows={3} />
          ) : groups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">
                <Icon name="users" size={22} />
              </div>
              <p className="mt-4 text-lg font-medium">No groups yet. The calm before the tab.</p>
              <p className="mt-1 text-sm text-muted">
                Make one to start splitting, or{' '}
                <Link to="/split" className="font-medium text-accent hover:underline">
                  do a quick split
                </Link>{' '}
                without an account.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {groups.map((group) => {
                const label = perGroupLabel(group.netCents);
                return (
                  <li key={group.id}>
                    <Link
                      to={`/groups/${group.id}`}
                      className="row-interactive surface flex items-center gap-4 rounded-2xl p-4 hover:shadow-lg hover:shadow-black/20"
                    >
                      <Avatar name={group.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{group.name}</span>
                        <span className="block text-sm text-muted">
                          {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
                        </span>
                      </span>
                      <span className={`tnum text-sm font-semibold ${label.className}`}>
                        {label.text}
                      </span>
                      <Icon name="chevron-right" size={18} className="text-faint" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
