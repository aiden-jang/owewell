import type { ReactNode } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';

export function ProtectedRoute(): ReactNode {
  const { user, sessionError, retrySession } = useAuth();
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
    // Login is optional: send signed-out visitors to the quick-split calculator.
    return <Navigate to="/split" replace />;
  }
  return <Outlet />;
}
