import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from './BrandMark';

/** The header a signed-out visitor gets: the mark, and the two ways in. */
export function PublicHeader(): ReactNode {
  const { login, signup } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
        <Link
          to="/split"
          className="tap flex items-center gap-2 font-display text-xl font-semibold tracking-tight"
        >
          <BrandMark /> owewell
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => login(window.location.origin)}
            className="tap rounded-full px-3 py-1.5 text-muted transition hover:text-ink"
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
