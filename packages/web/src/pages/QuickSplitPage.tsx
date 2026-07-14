import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Money, computeSplit, dollarsToCents, simplifyDebts, type SplitMethod, type Transfer } from '@owewell/shared';
import { normalizeAmountInput } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { BrandMark } from '../components/BrandMark';
import {
  clearPendingSplit,
  quickSplitApi,
  stashPendingSplit,
  type PendingItem,
  type PendingSplit,
} from '../lib/quicksplit';
import { SPLIT_METHODS, splitMethodHint, splitMethodUnit } from '../lib/splitMethods';

interface Person {
  id: string;
  name: string;
}

interface Item {
  id: string;
  description: string;
  amount: string;
  method: SplitMethod;
  /** Per-person raw value inputs (shares / percent / exact), keyed by person id. */
  values: Record<string, string>;
  /** Person id of who paid for this item. Empty → the default payer. */
  payerId: string;
}

function newPerson(name = ''): Person {
  return { id: crypto.randomUUID(), name };
}

function newItem(): Item {
  return { id: crypto.randomUUID(), description: '', amount: '', method: 'EQUAL', values: {}, payerId: '' };
}

/** Parse a raw per-person input into the server value for a method, or undefined for EQUAL. */
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
  const { login, signup } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
        <Link to="/split" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <BrandMark /> owewell
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => login(window.location.origin)}
            className="rounded-full px-3 py-1.5 text-muted transition hover:text-ink"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => signup(window.location.origin)}
            className="btn-gradient rounded-full px-4 py-1.5 font-semibold transition active:scale-[0.98]"
          >
            Sign up
          </button>
        </div>
      </div>
    </header>
  );
}

export function QuickSplitPage(): ReactNode {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [people, setPeople] = useState<Person[]>([newPerson('You'), newPerson('')]);
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [payerId, setPayerId] = useState<string>('');
  // Off by default: one payer for the whole bill. On: a per-item "paid by" for split tabs.
  const [splitPayers, setSplitPayers] = useState(false);
  const [youId, setYouId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const named = people.filter((p) => p.name.trim());

  // Default the payer/you to the first named person until they choose. Both must resolve to a
  // person who's actually in the split (has a name), so a blank or since-removed selection can't
  // make Save fail with "Pick who paid" while a payer radio still looks chosen.
  const effectivePayerId =
    payerId && named.some((p) => p.id === payerId) ? payerId : (named[0]?.id ?? '');
  const effectiveYouId =
    youId && named.some((p) => p.id === youId) ? youId : (named[0]?.id ?? people[0]?.id ?? '');

  function updatePerson(id: string, patch: Partial<Person>): void {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function addPerson(): void {
    setPeople((prev) => [...prev, newPerson('')]);
  }
  function removePerson(id: string): void {
    if (people.length <= 2) return;
    setPeople((prev) => prev.filter((p) => p.id !== id));
    // Drop any per-item payer pointing at the removed person so it can't linger as a dangling
    // reference (which would silently reassign that item's payment on save).
    setItems((prev) => prev.map((it) => (it.payerId === id ? { ...it, payerId: '' } : it)));
  }

  function updateItem(id: string, patch: Partial<Item>): void {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function updateItemValue(itemId: string, personId: string, value: string): void {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, values: { ...it.values, [personId]: value } } : it)),
    );
  }
  function addItem(): void {
    setItems((prev) => [...prev, newItem()]);
  }
  function removeItem(id: string): void {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  }

  // Live running total for one item's non-equal split, so values that don't add
  // up are visible before saving. Mirrors the group expense form.
  function itemSplitHint(item: Item): { text: string; tone: string } | null {
    if (item.method === 'EQUAL') return null;
    const raws = named.map((p) => (item.values[p.id] ?? '').trim()).filter(Boolean);
    if (item.method === 'EXACT') {
      let sum = 0;
      let ok = true;
      for (const r of raws) {
        try {
          sum += dollarsToCents(r);
        } catch {
          ok = false;
        }
      }
      let target = 0;
      try {
        target = item.amount.trim() ? dollarsToCents(item.amount) : 0;
      } catch {
        target = 0;
      }
      const tone = !ok ? 'text-neg' : target > 0 && sum === target ? 'text-pos' : sum > target ? 'text-neg' : 'text-muted';
      return { text: `${Money.fromCents(sum).format()} of ${Money.fromCents(target).format()}`, tone };
    }
    if (item.method === 'PERCENT') {
      let sum = 0;
      let ok = true;
      for (const r of raws) {
        const n = Number(r);
        if (Number.isFinite(n)) sum += n;
        else ok = false;
      }
      const rounded = Math.round(sum * 100) / 100;
      const tone = !ok ? 'text-neg' : rounded === 100 ? 'text-pos' : rounded > 100 ? 'text-neg' : 'text-muted';
      return { text: `${rounded}% of 100%`, tone };
    }
    let sum = 0;
    for (const r of raws) {
      const n = Number(r);
      if (Number.isFinite(n)) sum += n;
    }
    return { text: `${sum} share${sum === 1 ? '' : 's'} total`, tone: 'text-muted' };
  }

  // Live combined breakdown: each person's total share summed across every valid item, or null
  // until at least one item has a usable amount + valid per-person values.
  let transfers: Transfer[] | null = null;
  let grandTotal = 0;
  try {
    const owedAcc: Record<string, number> = Object.fromEntries(named.map((p) => [p.id, 0]));
    const paidAcc: Record<string, number> = Object.fromEntries(named.map((p) => [p.id, 0]));
    let any = false;
    for (const item of items) {
      const amountCents = item.amount.trim() ? dollarsToCents(item.amount) : 0;
      if (amountCents <= 0 || named.length === 0) continue;
      const shares = computeSplit(
        item.method,
        amountCents,
        named.map((p) => {
          const value = serverValue(item.method, item.values[p.id] ?? '');
          return value === undefined ? { userId: p.id } : { userId: p.id, value };
        }),
      );
      for (const s of shares) owedAcc[s.userId] = (owedAcc[s.userId] ?? 0) + s.owedCents;
      // A per-item payer who isn't a named participant (blank or since-removed) falls back to the
      // default payer, exactly as the save path does, so the preview can't diverge from the result.
      const rawPayer = splitPayers && item.payerId ? item.payerId : effectivePayerId;
      const itemPayer = paidAcc[rawPayer] !== undefined ? rawPayer : effectivePayerId;
      paidAcc[itemPayer] = (paidAcc[itemPayer] ?? 0) + amountCents;
      grandTotal += amountCents;
      any = true;
    }
    // Net each person (paid across the items they covered, minus what they owe), then reduce to
    // the fewest transfers — the same math the saved group will show.
    transfers = any
      ? simplifyDebts(named.map((p) => ({ userId: p.id, netCents: (paidAcc[p.id] ?? 0) - (owedAcc[p.id] ?? 0) })))
      : null;
  } catch {
    transfers = null;
  }

  const nameById = (id: string): string => people.find((p) => p.id === id)?.name.trim() || 'Someone';

  async function onSave(): Promise<void> {
    setError(null);
    if (named.length < 2) {
      setError('Add at least two people.');
      return;
    }
    if (!named.some((p) => p.id === effectivePayerId)) {
      setError('Pick who paid.');
      return;
    }

    const builtItems: PendingItem[] = [];
    for (const item of items) {
      if (!item.amount.trim()) continue;
      let amountCents: number;
      try {
        amountCents = dollarsToCents(item.amount);
      } catch {
        setError('Enter a valid amount for each item.');
        return;
      }
      if (amountCents <= 0) {
        setError('Each item amount must be more than zero.');
        return;
      }
      let values: (number | null)[];
      try {
        values = named.map((p) => serverValue(item.method, item.values[p.id] ?? '') ?? null);
      } catch {
        setError('Check the per-person values on each item.');
        return;
      }
      // Only send per-item payers when the split-tabs toggle is on; otherwise the backend
      // falls back to the single default payer.
      const payerIndex = splitPayers ? named.findIndex((p) => p.id === (item.payerId || effectivePayerId)) : -1;
      builtItems.push({
        description: item.description.trim() || 'Quick split',
        amountCents,
        splitMethod: item.method,
        values,
        ...(payerIndex >= 0 ? { payerIndex } : {}),
      });
    }
    if (builtItems.length === 0) {
      setError('Add at least one item with an amount.');
      return;
    }

    const pending: PendingSplit = {
      people: named.map((p) => ({
        name: p.name.trim(),
        isPayer: p.id === effectivePayerId,
        isYou: p.id === effectiveYouId,
      })),
      items: builtItems,
    };
    stashPendingSplit(pending);

    if (!user) {
      // Stash it, send them to sign up on the shared auth service, and land back on the dashboard,
      // which offers to save the pending split once they're signed in.
      signup(window.location.origin);
      return;
    }

    setSaving(true);
    try {
      const { groupId } = await quickSplitApi.save(pending);
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
    <div className="flex-1">
      {user ? <AppHeader /> : <PublicHeader />}
      <main className="mx-auto max-w-xl animate-rise px-4 py-10">
        {user ? (
          <>
            <h1 className="font-display text-4xl font-semibold tracking-tight">Split a bill</h1>
            <p className="mt-2 text-base text-muted">
              Somebody paid, everybody forgot. Add the group, drop in the damage, and find out who
              owes who. No account unless you get attached.
            </p>
          </>
        ) : (
          <section className="mb-9">
            <p className="text-sm font-semibold text-accent">owewell</p>
            <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
              Split the bill.
              <br />
              Keep the friends.
            </h1>
            <p className="mt-3 text-base text-muted">
              Who owes who, sorted in about ten seconds. Add people, punch in what got spent, and
              let the math do the awkward part.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {['No account needed', 'Works on your phone', 'Save it when you get attached'].map(
                (t) => (
                  <span key={t} className="rounded-full border border-line bg-field px-3 py-1 text-muted">
                    {t}
                  </span>
                ),
              )}
            </div>
            <p className="mt-6 text-sm font-medium text-muted">Try it right here, no sign-up:</p>
          </section>
        )}

        {/* People — shared across every item */}
        <div className="glass mt-6 space-y-2 rounded-3xl p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Who's splitting</h2>
          {people.map((person, index) => (
            <div key={person.id} className="flex items-center gap-2">
              <input
                value={person.name}
                onChange={(e) => updatePerson(person.id, { name: e.target.value })}
                placeholder={`Person ${index + 1}`}
                className={inputClass}
                aria-label={`Person ${index + 1} name`}
              />
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

          <label className="block pt-2 text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Which one are you?</span>
            <select
              value={effectiveYouId}
              onChange={(e) => setYouId(e.target.value)}
              className={inputClass}
              aria-label="Which one are you"
            >
              {named.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name.trim()}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Items — one expense per row, each split its own way among everyone above */}
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">What you spent</h2>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={splitPayers}
                onChange={(e) => setSplitPayers(e.target.checked)}
              />
              different people paid
            </label>
          </div>
          {items.map((item, index) => (
            <div key={item.id} className="glass space-y-3 rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <input
                  value={item.description}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                  placeholder={`Item ${index + 1} (e.g. Dinner)`}
                  className={inputClass}
                  aria-label={`Item ${index + 1} description`}
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="rounded-lg border border-line px-2 text-muted transition hover:bg-canvas"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={item.amount}
                  onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                  onBlur={() => updateItem(item.id, { amount: normalizeAmountInput(item.amount) })}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={inputClass}
                  aria-label={`Item ${index + 1} amount`}
                />
                <select
                  value={item.method}
                  onChange={(e) => updateItem(item.id, { method: e.target.value as SplitMethod })}
                  className={inputClass}
                  aria-label={`Item ${index + 1} split method`}
                >
                  {SPLIT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      Split {m.label.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              {splitPayers && named.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>paid by</span>
                  <select
                    value={item.payerId || effectivePayerId}
                    onChange={(e) => updateItem(item.id, { payerId: e.target.value })}
                    aria-label={`Item ${index + 1} paid by`}
                    className="flex-1 rounded-lg border border-line bg-field px-2 py-1.5 text-ink outline-none focus:border-accent"
                  >
                    {named.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name.trim() || 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {item.method !== 'EQUAL' && named.length > 0 && (
                <div className="space-y-1.5 border-t border-line pt-2">
                  <p className="text-xs text-muted">{splitMethodHint(item.method)}</p>
                  {named.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-muted">{p.name.trim()}</span>
                      <input
                        value={item.values[p.id] ?? ''}
                        onChange={(e) => updateItemValue(item.id, p.id, e.target.value)}
                        placeholder="0"
                        inputMode="decimal"
                        className="w-20 rounded-lg border border-line bg-field px-2 py-1.5 text-right outline-none focus:border-accent"
                        aria-label={`${p.name.trim()} ${splitMethodUnit(item.method)} for item ${index + 1}`}
                      />
                      <span className="w-10 text-xs text-muted">{splitMethodUnit(item.method)}</span>
                    </div>
                  ))}
                  {(() => {
                    const hint = itemSplitHint(item);
                    return hint ? (
                      <p className={`text-right text-xs tabular-nums ${hint.tone}`} aria-live="polite">
                        {hint.text}
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="text-sm font-medium text-accent transition hover:underline"
          >
            + Add item
          </button>
        </div>

        <section className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Who owes what</h2>
            {transfers && <span className="text-sm text-muted">total {Money.fromCents(grandTotal).format()}</span>}
          </div>
          {transfers ? (
            transfers.length === 0 ? (
              <p className="mt-3 text-sm text-muted">All settled up. Nobody owes anybody.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {transfers.map((t) => (
                  <li
                    key={`${t.fromUserId}-${t.toUserId}`}
                    className="flex items-center justify-between rounded-xl glass px-4 py-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">{nameById(t.fromUserId)}</span> owes{' '}
                      <span className="font-medium">{nameById(t.toUserId)}</span>
                    </span>
                    <span className="font-medium tabular-nums">{Money.fromCents(t.amountCents).format()}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="mt-3 text-sm text-muted">
              Names up top, numbers in the middle. We&rsquo;ll handle the part that ends friendships.
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
          {saving ? 'Saving...' : user ? 'Save to my account' : "Save it before someone 'forgets'"}
        </button>
        {user && (
          <Link to="/" className="mt-3 block text-center text-sm font-medium text-accent">
            Back to your groups
          </Link>
        )}

        {!user && (
          <section className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { icon: '🧮', title: 'Split it any way', body: 'Evenly, by shares, by percent, or exact. However the argument shakes out.' },
              { icon: '🧾', title: 'Itemize the chaos', body: "Separate line items, because you didn't touch the calamari." },
              { icon: '🤝', title: 'Settle up', body: 'We boil tangled debts down to the fewest Venmos humanly possible.' },
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
