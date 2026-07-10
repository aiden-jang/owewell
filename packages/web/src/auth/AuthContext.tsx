import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loginUrl, logoutUrl, signupUrl } from '@aidenjang/auth-client';
import { api, AUTH_ORIGIN } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
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

  useEffect(() => {
    api
      .get<{ user: AuthUser | null; personId?: string }>('/me')
      // The client compares against owewell person ids everywhere (group members,
      // balances, payers), so expose the person id as `user.id` rather than the
      // auth-service user id — otherwise isOwner, balances, and "you" never match.
      .then((res) => setUser(res.user ? { ...res.user, id: res.personId ?? res.user.id } : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: (returnTo?: string) => {
        window.location.assign(loginUrl(AUTH_ORIGIN, returnTo ?? here()));
      },
      signup: (returnTo?: string) => {
        window.location.assign(signupUrl(AUTH_ORIGIN, returnTo ?? here()));
      },
      logout: (returnTo?: string) => {
        window.location.assign(logoutUrl(AUTH_ORIGIN, returnTo ?? window.location.origin));
      },
      accountUrl: new URL('/account', AUTH_ORIGIN).toString(),
    }),
    [user, loading],
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
