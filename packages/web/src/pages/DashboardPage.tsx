import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

export function DashboardPage(): ReactNode {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold tracking-tight">Owe Well</span>
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

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Hey, {user?.displayName}.</h1>
        <div className="mt-8 rounded-2xl border border-line bg-card p-10 text-center">
          <p className="text-lg font-medium">No debts. Suspiciously responsible of you.</p>
          <p className="mt-2 text-sm text-muted">Groups and expenses land here next.</p>
        </div>
      </main>
    </div>
  );
}
