import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

/** Public content stays usable while account-dependent actions wait for a session. */
export function SessionNotice(): ReactNode {
  const { loading, sessionError, retrySession } = useAuth();
  if (!loading && !sessionError) return null;
  return (
    <p className="mt-3 text-sm text-muted" role="status">
      {loading ? (
        'Checking your sign-in…'
      ) : (
        <>
          We couldn’t check your sign-in.{' '}
          <button
            type="button"
            onClick={() => void retrySession()}
            className="tap rounded-full font-medium text-accent underline underline-offset-4"
          >
            Try again
          </button>
        </>
      )}
    </p>
  );
}
