import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
  where: string | null;
}

/**
 * Catches render-time crashes so a thrown component doesn't blank the whole app.
 *
 * It shows what broke, collapsed. The first version logged to console and displayed nothing, which
 * meant a crash reported as "this page says Well, that broke" carried no information at all: the
 * only way to learn anything was to have the person open devtools, which on a phone is not a thing
 * that happens. Everyone who uses this app can screenshot. So the screenshot has to be enough.
 *
 * Collapsed rather than inline, because the point of the friendly copy is that a crash shouldn't
 * feel like a stack trace. Open it and it is one.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: null, where: null };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || String(error),
      // Just the first few frames. The whole component stack is dozens of lines of providers and
      // routers, and the useful part is always at the top.
      where: null,
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error:', error, info.componentStack);
    const where = (info.componentStack ?? '')
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 4)
      .join('\n');
    this.setState({ where });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        {/* Drawn, like the 404 and the empty states. Muted rather than accent: this is the one
            screen where nothing worked, and a cheerful brand colour would be the wrong note. */}
        <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-surface2 text-muted">
          <Icon name="alert" size={26} />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Well, that broke.</h1>
        <p className="mt-2 text-sm text-muted">Probably our fault. Probably.</p>
        <a
          href="/"
          className="mt-6 rounded-full btn-gradient px-5 py-2.5 font-medium shadow-sm transition active:scale-[0.98]"
        >
          Back to your groups
        </a>
        {this.state.message && (
          <details className="mt-8 w-full max-w-md text-left">
            <summary className="cursor-pointer text-xs text-muted">What broke</summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-card p-3 text-2xs leading-relaxed text-muted">
              {this.state.message}
              {this.state.where ? `\n\n${this.state.where}` : ''}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
