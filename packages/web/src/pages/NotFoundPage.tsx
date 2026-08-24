import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function NotFoundPage(): ReactNode {
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      {/* Drawn, not 🧾. Colour emoji is a different picture on every platform, which is the reason
          the category chips gave theirs up — and this one was the largest in the app. */}
      <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon name="receipt" size={26} />
      </span>
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Lost the receipt.</h1>
      <p className="mt-2 text-sm text-muted">That page isn&apos;t here.</p>
      <Link
        to="/"
        className="mt-6 rounded-full btn-gradient px-5 py-2.5 font-medium shadow-sm transition active:scale-[0.98]"
      >
        Take me home
      </Link>
    </main>
  );
}
