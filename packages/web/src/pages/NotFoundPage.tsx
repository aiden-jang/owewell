import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): ReactNode {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl" aria-hidden>
        🧾
      </p>
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">Lost the receipt.</h1>
      <p className="mt-2 text-sm text-muted">That page isn&apos;t here.</p>
      <Link
        to="/"
        className="mt-6 rounded-full btn-gradient px-5 py-2.5 font-medium shadow-sm transition active:scale-[0.98]"
      >
        Take me home
      </Link>
    </div>
  );
}
