import type { ReactNode } from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-rise">
        <h1 className="mb-6 flex items-center justify-center gap-2 font-display text-3xl font-semibold tracking-tight">
          <span aria-hidden>🧾</span> Owe Well
        </h1>
        <div className="rounded-3xl border border-line bg-card p-7 shadow-sm">
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-5 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}
