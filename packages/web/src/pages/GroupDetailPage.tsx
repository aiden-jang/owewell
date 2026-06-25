import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Money } from '@owe-well/shared';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { groupsApi, type Balance, type GroupDetail } from '../lib/groups';
import { expensesApi, type Expense } from '../lib/expenses';
import { settlementsApi, type SuggestedPayment } from '../lib/settlements';
import { invitesApi } from '../lib/invites';
import { useGroupRealtime } from '../hooks/useGroupRealtime';

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
      <main className="mx-auto max-w-3xl animate-rise px-4 py-10">{children}</main>
    </div>
  );
}

export function GroupDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suggested, setSuggested] = useState<SuggestedPayment[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [expenseMode, setExpenseMode] = useState<'simple' | 'itemized'>('simple');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [g, b, e, s] = await Promise.all([
        groupsApi.get(id),
        groupsApi.balances(id),
        expensesApi.list(id),
        settlementsApi.suggested(id),
      ]);
      setGroup(g);
      setBalances(b);
      setExpenses(e);
      setSuggested(s);
    } catch {
      setNotFound(true);
    }
  }

  async function refreshLedger(): Promise<void> {
    const [b, e, s] = await Promise.all([
      groupsApi.balances(id),
      expensesApi.list(id),
      settlementsApi.suggested(id),
    ]);
    setBalances(b);
    setExpenses(e);
    setSuggested(s);
  }

  async function markPaid(payment: SuggestedPayment): Promise<void> {
    setSettling(true);
    try {
      await settlementsApi.record(id, {
        fromUserId: payment.fromUserId,
        toUserId: payment.toUserId,
        amountCents: payment.amountCents,
      });
      await refreshLedger();
    } finally {
      setSettling(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  // Live-refresh when anyone else changes this group.
  useGroupRealtime(id, () => {
    void refreshLedger();
  });

  async function deleteExpense(expenseId: string): Promise<void> {
    if (!window.confirm('Delete this expense?')) return;
    await expensesApi.remove(id, expenseId);
    await refreshLedger();
  }

  async function saveRename(): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const updated = await groupsApi.rename(id, trimmed);
    setGroup(updated);
    setRenaming(false);
  }

  async function deleteGroup(): Promise<void> {
    if (!window.confirm('Delete this whole group? This cannot be undone.')) return;
    await groupsApi.remove(id);
    navigate('/');
  }

  async function createInviteLink(): Promise<void> {
    setMemberError(null);
    try {
      const invite = await invitesApi.create(id);
      setInviteLink(`${window.location.origin}/invite/${invite.token}`);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Could not create a link.');
    }
  }

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

  const nameOf = (userId: string): string =>
    group.members.find((m) => m.userId === userId)?.displayName ?? 'Someone';
  const balanceByUser = Object.fromEntries(balances.map((b) => [b.userId, b.netCents]));
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === 'OWNER';

  return (
    <Shell>
      <Link to="/" className="text-sm font-medium text-accent">
        &larr; Your groups
      </Link>
      {renaming ? (
        <div className="mt-2 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Group name"
            className="flex-1 rounded-xl border border-line bg-field px-3 py-2 font-display text-2xl outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void saveRename()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{group.name}</h1>
          {isOwner && (
            <div className="flex shrink-0 items-center gap-3 text-sm font-medium">
              <button
                type="button"
                onClick={() => {
                  setNewName(group.name);
                  setRenaming(true);
                }}
                className="text-muted transition hover:text-ink"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => void deleteGroup()}
                className="text-muted transition hover:text-accent"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      {(() => {
        const myNet = balanceByUser[user?.id ?? ''] ?? 0;
        const settled = myNet === 0;
        const owed = myNet > 0;
        return (
          <div className="mt-5 rounded-3xl border border-line bg-card p-6 shadow-sm">
            <p className="text-sm text-muted">
              {settled ? 'Your standing' : owed ? "You're owed" : 'You owe'}
            </p>
            <p
              className={`font-display text-4xl font-semibold ${
                settled ? 'text-ink' : owed ? 'text-emerald-600' : 'text-accent'
              }`}
            >
              {settled ? 'All settled' : Money.fromCents(Math.abs(myNet)).format()}
            </p>
          </div>
        );
      })()}

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
                <span className="flex items-center gap-3 font-medium">
                  <Avatar name={member.displayName} />
                  <span>
                    {member.displayName}
                    {member.role === 'OWNER' && (
                      <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">owner</span>
                    )}
                  </span>
                </span>
                <span className={`text-sm font-medium ${label.tone}`}>{label.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Settle up</h2>
        {suggested.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Everyone&apos;s even. Group hug optional.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {suggested.map((payment) => (
              <li
                key={`${payment.fromUserId}-${payment.toUserId}`}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Avatar name={payment.fromName} size="sm" />
                  <span>
                    <span className="font-medium">{payment.fromName}</span> pays{' '}
                    <span className="font-medium">{payment.toName}</span>{' '}
                    <span className="font-medium">
                      {Money.fromCents(payment.amountCents).format()}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void markPaid(payment)}
                  className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium transition hover:bg-canvas active:scale-[0.98] disabled:opacity-60"
                >
                  Mark paid
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Expenses</h2>
        {expenses.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-line p-8 text-center">
            <div className="text-3xl" aria-hidden>
              🧮
            </div>
            <p className="mt-2 text-sm text-muted">
              Nothing yet. Add one below and let the math sort itself out.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={nameOf(expense.payerId)} size="sm" />
                  <div>
                    <p className="font-medium">{expense.description}</p>
                    <p className="text-sm text-muted">paid by {nameOf(expense.payerId)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{Money.fromCents(expense.amountCents).format()}</span>
                  <button
                    type="button"
                    onClick={() => void deleteExpense(expense.id)}
                    aria-label={`Delete ${expense.description}`}
                    className="rounded-full px-2 py-1 text-muted transition hover:bg-canvas hover:text-accent"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 inline-flex rounded-full border border-line bg-canvas p-1">
          <button
            type="button"
            onClick={() => setExpenseMode('simple')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              expenseMode === 'simple' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            Split a total
          </button>
          <button
            type="button"
            onClick={() => setExpenseMode('itemized')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              expenseMode === 'itemized' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            Itemize a receipt
          </button>
        </div>
        {expenseMode === 'simple' ? (
          <AddExpenseForm
            key={`simple-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={() => void refreshLedger()}
          />
        ) : (
          <AddItemizedExpenseForm
            key={`itemized-${group.members.length}`}
            groupId={group.id}
            members={group.members}
            onCreated={() => void refreshLedger()}
          />
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Add someone</h2>
        <form onSubmit={(e) => void onAddMember(e)} className="mt-3 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com"
            className="flex-1 rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-accent-hover active:scale-[0.98]"
          >
            Add
          </button>
        </form>
        {memberError && <p className="mt-2 text-sm font-medium text-accent">{memberError}</p>}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void createInviteLink()}
            className="text-sm font-medium text-accent transition hover:underline"
          >
            Or create an invite link
          </button>
          {inviteLink && (
            <input
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
              aria-label="Invite link"
              className="mt-2 w-full rounded-xl border border-line bg-field px-3 py-2.5 text-sm text-muted outline-none"
            />
          )}
        </div>
      </section>
    </Shell>
  );
}
