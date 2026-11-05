import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function NotFoundPage(): ReactNode {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 py-10 text-center"
    >
      <div className="surface grid w-full justify-items-center rounded-2xl px-5 py-10">
        <span
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"
        >
          <Icon name="receipt" size={26} />
        </span>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Lost the receipt.</h1>
        <p className="mt-2 text-sm text-muted">That page isn&apos;t here. You can start again from home.</p>
        <Link
          to="/"
          className="mt-6 rounded-full btn-gradient px-5 py-2.5 font-medium shadow-sm transition active:scale-[0.98]"
        >
          Take me home
        </Link>
      </div>
    </main>
  );
}
