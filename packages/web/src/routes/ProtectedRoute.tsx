import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { BrandMark } from '../components/BrandMark';

export function ProtectedRoute(): ReactNode {
  const { user, login, loading, sessionError, retrySession } = useAuth();
  const { pathname } = useLocation();
  if (loading) {
    return (
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-muted"
      >
        <span className="motion-safe:animate-pulse">
          <BrandMark size={40} />
        </span>
        <p role="status" aria-label="Checking sign-in" className="text-sm">
          Checking your sign-in…
        </p>
        <Link to="/split" className="text-sm font-medium text-accent hover:underline">
          Use quick split without an account
        </Link>
      </main>
    );
  }
  if (sessionError && !user) {
    return (
      <div className="flex-1">
        <AppHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-8">
          <EmptyState
            titleAs="h1"
            tone="problem"
            icon="wallet"
            title="Couldn’t check your sign-in."
            body="Your sign-in may still be valid. Wait a moment, then try again."
            action={<Button onClick={() => void retrySession()}>Try again</Button>}
          />
          <Link
            to="/split"
            className="mt-4 block text-center text-sm font-medium text-accent hover:underline"
          >
            Use quick split without an account
          </Link>
        </main>
      </div>
    );
  }
  if (!user) {
    if (pathname === '/') return <Navigate to="/split" replace />;
    return (
      <div className="flex-1">
        <AppHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-8">
          <EmptyState
            titleAs="h1"
            tone="invite"
            icon="users"
            title="Sign in to open this group"
            body="We’ll bring you back to this group after you sign in."
            action={
              <Button block={false} onClick={() => login()}>
                Sign in
              </Button>
            }
          />
          <Link
            to="/split"
            className="mt-4 block text-center text-sm font-medium text-accent hover:underline"
          >
            Use quick split without an account
          </Link>
        </main>
      </div>
    );
  }
  return <Outlet />;
}
