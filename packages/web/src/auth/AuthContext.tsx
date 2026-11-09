import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAsyncScope } from '../lib/useAsyncScope';
import { loginUrl, logoutUrl, signupUrl } from '@aidenjang/auth-client';
import { api, AUTH_ORIGIN } from '../lib/api';
import { rememberLastAccount } from '../lib/lastAccount';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  sessionError: boolean;
  retrySession: () => Promise<void>;
  /** Send the visitor to the shared sign-in page, returning them here afterward. */
  login: (returnTo?: string) => void;
  /** Send the visitor to the shared sign-up page, returning them here afterward. */
  signup: (returnTo?: string) => void;
  /** Sign out at the shared auth service, then return here. */
  logout: (returnTo?: string) => void;
  /** The shared account page (name, email, password all live there now). */
  accountUrl: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const here = (): string => window.location.href;

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const { begin } = useAsyncScope();

  const checkSession = useCallback(
    async (showLoading: boolean) => {
      const current = begin();
      if (showLoading) {
        setLoading(true);
        setSessionError(false);
      }
      try {
        const res = await api.get<{ user: AuthUser | null; personId?: string }>('/me');
        if (!current()) return;
        // Ledger membership compares app-local person IDs rather than Accounts user IDs.
        setSessionError(false);
        const account = res.user ? { ...res.user, id: res.personId ?? res.user.id } : null;
        rememberLastAccount(account?.id ?? null);
        setUser((previous) =>
          previous?.id === account?.id &&
          previous?.displayName === account?.displayName &&
          previous?.email === account?.email
            ? previous
            : account,
        );
      } catch {
        if (current() && showLoading) setSessionError(true);
      } finally {
        if (current() && showLoading) setLoading(false);
      }
    },
    [begin],
  );
  const retrySession = useCallback(() => checkSession(true), [checkSession]);
  useEffect(() => {
    void retrySession();
  }, [retrySession]);
  useEffect(() => {
    if (loading || sessionError) return;
    const refresh = () => void checkSession(false);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [checkSession, loading, sessionError]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      sessionError,
      retrySession,
      login: (returnTo?: string) => {
        window.location.assign(loginUrl(AUTH_ORIGIN, returnTo ?? here()));
      },
      signup: (returnTo?: string) => {
        window.location.assign(signupUrl(AUTH_ORIGIN, returnTo ?? here()));
      },
      logout: (returnTo?: string) => {
        rememberLastAccount(null);
        window.location.assign(logoutUrl(AUTH_ORIGIN, returnTo ?? window.location.origin));
      },
      accountUrl: new URL('/account', AUTH_ORIGIN).toString(),
    }),
    [user, loading, sessionError, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
