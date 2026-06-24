import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Money } from '@owe-well/shared';
import { AppHeader } from '../components/AppHeader';
import { AddExpenseForm } from '../components/AddExpenseForm';
import { AddItemizedExpenseForm } from '../components/AddItemizedExpenseForm';
import { groupsApi, type Balance, type GroupDetail } from '../lib/groups';
import { expensesApi, type Expense } from '../lib/expenses';
import { settlementsApi, type SuggestedPayment } from '../lib/settlements';
import { invitesApi } from '../lib/invites';

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
                <span className="text-sm">
                  <span className="font-medium">{payment.fromName}</span> pays{' '}
                  <span className="font-medium">{payment.toName}</span>{' '}
                  <span className="font-medium">{Money.fromCents(payment.amountCents).format()}</span>
                </span>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void markPaid(payment)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:bg-canvas disabled:opacity-60"
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
          <p className="mt-3 text-sm text-muted">Nothing yet. Add the first one below.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{expense.description}</p>
                  <p className="text-sm text-muted">paid by {nameOf(expense.payerId)}</p>
                </div>
                <span className="font-medium">{Money.fromCents(expense.amountCents).format()}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setExpenseMode('simple')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              expenseMode === 'simple' ? 'bg-accent text-white' : 'border border-line hover:bg-canvas'
            }`}
          >
            Split a total
          </button>
          <button
            type="button"
            onClick={() => setExpenseMode('itemized')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              expenseMode === 'itemized'
                ? 'bg-accent text-white'
                : 'border border-line hover:bg-canvas'
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
              className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-muted outline-none"
            />
          )}
        </div>
      </section>
    </Shell>
  );
}
