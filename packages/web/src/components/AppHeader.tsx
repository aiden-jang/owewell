import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

export function AppHeader(): ReactNode {
  const { user, logout, accountUrl } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas">
      <div className="workspace-width mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <Link
          to="/"
          className="tap flex min-h-11 items-center gap-2 font-display text-lg font-semibold tracking-tight"
        >
          <BrandMark /> owewell
        </Link>
        {user && (
          <div className="ml-auto flex max-w-full items-center gap-1.5">
            <a
              href={accountUrl}
              className="tap flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink sm:pr-3"
              aria-label="Account"
            >
              <Avatar name={user.displayName} size="sm" />
              <span className="hidden truncate sm:inline">{user.displayName}</span>
            </a>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Log out"
              className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
