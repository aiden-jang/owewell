import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from './BrandMark';

/** The header a signed-out visitor gets: the mark, and the two ways in. */
export function PublicHeader(): ReactNode {
  const { login, signup, loading, sessionError } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="workspace-width mx-auto flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] px-[16px] py-[8px]">
        <Link
          to="/split"
          className="tap flex items-center gap-2 font-display text-xl font-semibold tracking-tight"
        >
          <BrandMark /> owewell
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-[8px] text-sm font-medium">
          <button
            type="button"
            disabled={loading || sessionError}
            onClick={() => login(window.location.origin)}
            className="tap min-h-[44px] rounded-full px-[8px] py-[6px] text-muted transition hover:text-ink disabled:opacity-60 sm:px-[12px]"
          >
            Sign in
          </button>
          <button
            type="button"
            disabled={loading || sessionError}
            onClick={() => signup(window.location.origin)}
            className="btn-gradient min-h-[44px] rounded-full px-[12px] py-[6px] font-semibold transition active:scale-[0.98] disabled:opacity-60 sm:px-[16px]"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
}
