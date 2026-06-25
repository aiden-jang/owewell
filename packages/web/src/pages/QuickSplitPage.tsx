import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money, computeSplit, dollarsToCents, type SplitMethod } from '@owe-well/shared';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import {
  clearPendingSplit,
  quickSplitApi,
  stashPendingSplit,
  type PendingParticipant,
} from '../lib/quicksplit';

interface Person {
  id: string;
  name: string;
  value: string;
}

const METHODS: { value: SplitMethod; label: string }[] = [
  { value: 'EQUAL', label: 'Equally' },
  { value: 'SHARES', label: 'By shares' },
  { value: 'PERCENT', label: 'By percent' },
  { value: 'EXACT', label: 'Exact amounts' },
];

const VALUE_HINT: Record<SplitMethod, string> = {
  EQUAL: '',
  SHARES: 'shares',
  PERCENT: '%',
  EXACT: '$',
};

function newPerson(name = ''): Person {
  return { id: crypto.randomUUID(), name, value: '' };
}

function serverValue(method: SplitMethod, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (method === 'EQUAL') return undefined;
  if (method === 'EXACT') return dollarsToCents(trimmed);
  if (method === 'PERCENT') {
    const pct = Number(trimmed);
    if (!Number.isFinite(pct)) throw new Error('bad percent');
    return Math.round(pct * 100);
  }
  const weight = Number(trimmed);
  if (!Number.isInteger(weight) || weight <= 0) throw new Error('bad share');
  return weight;
}

function PublicHeader(): ReactNode {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
        <Link to="/split" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <span aria-hidden>🧾</span> Owe Well
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Link to="/login" className="rounded-full px-3 py-1.5 text-muted transition hover:text-ink">
            Log in
          </Link>
          <Link
            to="/signup"
            className="btn-gradient rounded-full px-4 py-1.5 font-semibold transition active:scale-[0.98]"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}

export function QuickSplitPage(): ReactNode {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SplitMethod>('EQUAL');
  const [people, setPeople] = useState<Person[]>([newPerson('You'), newPerson('')]);
  const [payerId, setPayerId] = useState<string>('');
  const [youId, setYouId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Default the payer/you to the first person until they choose.
  const effectivePayerId = payerId || people[0]?.id || '';
  const effectiveYouId = youId === '' && payerId === '' ? (people[0]?.id ?? '') : youId;

  function updatePerson(id: string, patch: Partial<Person>): void {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function addPerson(): void {
    setPeople((prev) => [...prev, newPerson('')]);
  }
  function removePerson(id: string): void {
    setPeople((prev) => (prev.length <= 2 ? prev : prev.filter((p) => p.id !== id)));
  }

  // Live breakdown: map each person to their owed cents, or null if the inputs aren't valid yet.
  let owed: Record<string, number> | null = null;
  try {
    const named = people.filter((p) => p.name.trim());
    const amountCents = amount.trim() ? dollarsToCents(amount) : 0;
    if (amountCents > 0 && named.length > 0) {
      const shares = computeSplit(
        method,
        amountCents,
        named.map((p) => {
          const value = serverValue(method, p.value);
          return value === undefined ? { userId: p.id } : { userId: p.id, value };
        }),
      );
      owed = Object.fromEntries(shares.map((s) => [s.userId, s.owedCents]));
    }
  } catch {
    owed = null;
  }

  const payerName = people.find((p) => p.id === effectivePayerId)?.name.trim() || 'the payer';

  async function onSave(): Promise<void> {
    setError(null);
    const named = people.filter((p) => p.name.trim());
    if (named.length < 2) {
      setError('Add at least two people.');
      return;
    }
    let amountCents: number;
    try {
      amountCents = dollarsToCents(amount);
    } catch {
      setError('Enter a valid amount.');
      return;
    }
    if (amountCents <= 0) {
      setError('Amount must be more than zero.');
      return;
    }

    let participants: PendingParticipant[];
    try {
      participants = named.map((p) => {
        const value = serverValue(method, p.value);
        return {
          name: p.name.trim(),
          ...(value === undefined ? {} : { value }),
          isPayer: p.id === effectivePayerId,
          isYou: p.id === effectiveYouId,
        };
      });
    } catch {
      setError('Check the values for each person.');
      return;
    }
    if (!participants.some((p) => p.isPayer)) {
      setError('Pick who paid.');
      return;
    }

    const split = {
      description: description.trim() || 'Quick split',
      amountCents,
      splitMethod: method,
      participants,
    };
    stashPendingSplit(split);

    if (!user) {
      // Save it after they make an account.
      navigate('/signup');
      return;
    }

    setSaving(true);
    try {
      const { groupId } = await quickSplitApi.save(split);
      clearPendingSplit();
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the split.');
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <div className="min-h-screen">
      {user ? <AppHeader /> : <PublicHeader />}
      <main className="mx-auto max-w-xl animate-rise px-4 py-10">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Split a bill</h1>
        <p className="mt-2 text-base text-muted">
          Who owes who, minus the group-chat math. No login required, save it if you get attached.
        </p>

        <div className="glass mt-6 space-y-3 rounded-3xl p-5">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was it for?"
            className={inputClass}
            aria-label="Description"
          />
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className={inputClass}
              aria-label="Amount"
            />
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as SplitMethod)}
              className={inputClass}
              aria-label="Split method"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  Split {m.label.toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {people.map((person, index) => (
              <div key={person.id} className="flex items-center gap-2">
                <input
                  value={person.name}
                  onChange={(e) => updatePerson(person.id, { name: e.target.value })}
                  placeholder={`Person ${index + 1}`}
                  className={inputClass}
                  aria-label={`Person ${index + 1} name`}
                />
                {method !== 'EQUAL' && (
                  <div className="flex items-center gap-1">
                    <input
                      value={person.value}
                      onChange={(e) => updatePerson(person.id, { value: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      className="w-20 rounded-lg border border-line bg-field px-2 py-1.5 text-right outline-none focus:border-accent"
                      aria-label={`Person ${index + 1} value`}
                    />
                    <span className="w-10 text-xs text-muted">{VALUE_HINT[method]}</span>
                  </div>
                )}
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input
                    type="radio"
                    name="payer"
                    checked={effectivePayerId === person.id}
                    onChange={() => setPayerId(person.id)}
                  />
                  paid
                </label>
                {people.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removePerson(person.id)}
                    className="rounded-lg border border-line px-2 text-muted transition hover:bg-canvas"
                    aria-label={`Remove person ${index + 1}`}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addPerson}
              className="text-sm font-medium text-accent transition hover:underline"
            >
              + Add person
            </button>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">
              Which one is you? (for saving)
            </span>
            <select
              value={effectiveYouId}
              onChange={(e) => setYouId(e.target.value)}
              className={inputClass}
              aria-label="Which one is you"
            >
              <option value="">Not in this split</option>
              {people
                .filter((p) => p.name.trim())
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name.trim()}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Who owes what</h2>
          {owed ? (
            <ul className="mt-3 space-y-2">
              {people
                .filter((p) => p.name.trim() && p.id !== effectivePayerId && owed)
                .map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-xl glass px-4 py-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">{p.name.trim()}</span> owes {payerName}
                    </span>
                    <span className="font-medium">
                      {Money.fromCents(owed[p.id] ?? 0).format()}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Add a total and a couple of names. The math is on us.
            </p>
          )}
        </section>

        {error && <p className="mt-4 text-sm font-medium text-accent">{error}</p>}
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="btn-gradient mt-5 w-full rounded-full px-5 py-3 font-semibold transition active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? 'Saving...' : user ? 'Save to my account' : 'Sign up to keep this'}
        </button>
        {user && (
          <Link to="/" className="mt-3 block text-center text-sm font-medium text-accent">
            Back to your groups
          </Link>
        )}

        {!user && (
          <section className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { icon: '🧮', title: 'Split any way', body: 'Evenly, by shares, percent, or exact amounts.' },
              { icon: '🤝', title: 'Settle simply', body: 'We boil tangled debts down to the fewest payments.' },
              { icon: '🧾', title: 'Itemize receipts', body: 'Snap a photo, assign items, skip the squinting.' },
            ].map((f) => (
              <div key={f.title} className="glass rounded-2xl p-4">
                <span className="text-2xl" aria-hidden>
                  {f.icon}
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
