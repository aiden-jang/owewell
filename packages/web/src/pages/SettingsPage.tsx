import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';

const inputClass =
  'w-full rounded-xl border border-line bg-field px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';
const buttonClass =
  'rounded-full bg-accent px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60';

export function SettingsPage(): ReactNode {
  const { user, updateDisplayName, changePassword } = useAuth();
  const [name, setName] = useState(user?.displayName ?? '');
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  async function onSaveName(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    setNameMsg(null);
    setSavingName(true);
    try {
      await updateDisplayName(name.trim());
      setNameMsg('Saved.');
    } catch (err) {
      setNameMsg(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSavingName(false);
    }
  }

  async function onChangePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPwMsg(null);
    setSavingPw(true);
    try {
      await changePassword(current, next);
      setPwMsg({ ok: true, text: 'Password changed.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not change password.' });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-lg animate-rise px-4 py-10">
        <Link to="/" className="text-sm font-medium text-accent">
          &larr; Your groups
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">{user?.email}</p>

        <form
          onSubmit={(e) => void onSaveName(e)}
          className="mt-6 space-y-3 rounded-3xl border border-line bg-card p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Display name</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            aria-label="Display name"
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingName} className={buttonClass}>
              {savingName ? 'Saving...' : 'Save'}
            </button>
            {nameMsg && <span className="text-sm text-muted">{nameMsg}</span>}
          </div>
        </form>

        <form
          onSubmit={(e) => void onChangePassword(e)}
          className="mt-4 space-y-3 rounded-3xl border border-line bg-card p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Change password</h2>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            required
            className={inputClass}
            aria-label="Current password"
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            required
            minLength={8}
            className={inputClass}
            aria-label="New password"
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingPw} className={buttonClass}>
              {savingPw ? 'Updating...' : 'Update password'}
            </button>
            {pwMsg && (
              <span className={`text-sm ${pwMsg.ok ? 'text-emerald-600' : 'text-accent'}`}>
                {pwMsg.text}
              </span>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
