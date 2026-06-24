import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { groupsApi, type GroupSummary } from '../lib/groups';
import { clearPendingSplit, loadPendingSplit, quickSplitApi } from '../lib/quicksplit';

export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [name, setName] = useState('');
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
        { id: group.id, name: group.name, createdAt: group.createdAt, memberCount: group.members.length },
        ...(prev ?? []),
      ]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that group.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        {pending && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3">
            <span className="text-sm">
              You have an unsaved split: <span className="font-medium">{pending.description}</span>.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void savePending()}
                disabled={savingPending}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
              >
                {savingPending ? 'Saving...' : 'Save it'}
              </button>
              <button
                type="button"
                onClick={dismissPending}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:bg-canvas"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <h1 className="text-2xl font-bold tracking-tight">Your groups</h1>

        <form onSubmit={(e) => void onCreate(e)} className="mt-6 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group name"
            className="flex-1 rounded-xl border border-line bg-white px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {creating ? 'Adding...' : 'Create'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm font-medium text-accent">{error}</p>}

        <div className="mt-8">
          {groups === null ? (
            <p className="text-muted">One sec...</p>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-line bg-card p-10 text-center">
              <p className="text-lg font-medium">No groups yet. The calm before the tab.</p>
              <p className="mt-2 text-sm text-muted">Make one above to start splitting.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    to={`/groups/${group.id}`}
                    className="flex items-center justify-between rounded-2xl border border-line bg-card p-4 transition hover:border-accent"
                  >
                    <span className="font-medium">{group.name}</span>
                    <span className="text-sm text-muted">
                      {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
