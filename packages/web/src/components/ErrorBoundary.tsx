import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Catches render-time crashes so a thrown component doesn't blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <p className="text-5xl" aria-hidden>
          🫠
        </p>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
          Well, that broke.
        </h1>
        <p className="mt-2 text-sm text-muted">Probably our fault. Probably.</p>
        <a
          href="/"
          className="mt-6 rounded-full bg-accent px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-accent-hover active:scale-[0.98]"
        >
          Reload
        </a>
      </div>
    );
  }
}
