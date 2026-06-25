import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';

export function AppHeader(): ReactNode {
  const { user, logout } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <span aria-hidden>🧾</span> Owe Well
        </Link>
        <div className="flex items-center gap-3">
          <Link
            to="/settings"
            className="flex items-center gap-2 text-sm font-medium text-muted transition hover:text-ink"
            aria-label="Settings"
          >
            {user && <Avatar name={user.displayName} size="sm" />}
            <span className="hidden sm:inline">{user?.displayName}</span>
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium transition hover:bg-canvas active:scale-[0.98]"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
