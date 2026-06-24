import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Money } from '@owe-well/shared';
import { AppHeader } from '../components/AppHeader';
import { groupsApi, type Balance, type GroupDetail } from '../lib/groups';

function balanceLabel(netCents: number): { text: string; tone: string } {
  if (netCents === 0) return { text: 'settled up', tone: 'text-muted' };
  const amount = Money.fromCents(Math.abs(netCents)).format();
  return netCents > 0
    ? { text: `is owed ${amount}`, tone: 'text-emerald-600' }
    : { text: `owes ${amount}`, tone: 'text-accent' };
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}

export function GroupDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [g, b] = await Promise.all([groupsApi.get(id), groupsApi.balances(id)]);
      setGroup(g);
      setBalances(b);
    } catch {
      setNotFound(true);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onAddMember(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!email.trim()) return;
    setMemberError(null);
    try {
      await groupsApi.addMember(id, email.trim());
      setEmail('');
      await load();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Could not add them.');
    }
  }

  if (notFound) {
    return (
      <Shell>
        <p className="text-lg font-medium">That group went missing. Or was never yours.</p>
        <Link to="/" className="mt-2 inline-block text-sm font-medium text-accent">
          Back to your groups
        </Link>
      </Shell>
    );
  }

  if (!group) {
    return (
      <Shell>
        <p className="text-muted">One sec...</p>
      </Shell>
    );
  }

  const balanceByUser = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));

  return (
    <Shell>
      <Link to="/" className="text-sm font-medium text-accent">
        &larr; Your groups
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{group.name}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Members</h2>
        <ul className="mt-3 space-y-2">
          {group.members.map((member) => {
            const label = balanceLabel(balanceByUser[member.userId] ?? 0);
            return (
              <li
                key={member.userId}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
              >
                <span className="font-medium">
                  {member.displayName}
                  {member.role === 'OWNER' && (
                    <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">owner</span>
                  )}
                </span>
                <span className={`text-sm font-medium ${label.tone}`}>{label.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Add someone</h2>
        <form onSubmit={(e) => void onAddMember(e)} className="mt-3 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com"
            className="flex-1 rounded-xl border border-line bg-white px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            className="rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
          >
            Add
          </button>
        </form>
        {memberError && <p className="mt-2 text-sm font-medium text-accent">{memberError}</p>}
      </section>
    </Shell>
  );
}
