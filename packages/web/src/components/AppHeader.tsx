import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';
import { SoundToggle } from './SoundToggle';

export function AppHeader(): ReactNode {
  const { user, logout, accountUrl } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight"
        >
          <BrandMark /> owewell
        </Link>
        <div className="flex items-center gap-1.5">
          <SoundToggle />
          <a
            href={accountUrl}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
            aria-label="Account"
          >
            {user && <Avatar name={user.displayName} size="sm" />}
            <span className="hidden sm:inline">{user?.displayName}</span>
          </a>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Log out"
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
