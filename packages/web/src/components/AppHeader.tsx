import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AppHeader(): ReactNode {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link to="/" className="text-lg font-bold tracking-tight">
          Owe Well
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{user?.displayName}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:bg-canvas"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
