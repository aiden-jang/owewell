import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * The boundary has to carry the reason, not just the apology.
 *
 * This exists because a real crash on a real group page cost an evening: the page said "Well, that
 * broke" and nothing else, so there was no way to tell a server fault from bad data from a render
 * bug without asking someone to open devtools on their phone. The friendly copy is fine. The
 * friendly copy being the ONLY output is what made it undiagnosable.
 */

function Boom({ why }: { why: string }): never {
  throw new Error(why);
}

// React logs caught errors to console.error regardless, which is noise here, not signal.
let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  quiet.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the actual app</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the actual app')).toBeInTheDocument();
    expect(screen.queryByText('Well, that broke.')).not.toBeInTheDocument();
  });

  it('catches a throwing child instead of blanking the app', () => {
    render(
      <ErrorBoundary>
        <Boom why="Cannot read properties of undefined (reading 'displayName')" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Well, that broke.')).toBeInTheDocument();
  });

  it('shows the error message, so a screenshot is enough to diagnose it', () => {
    render(
      <ErrorBoundary>
        <Boom why="Cannot read properties of undefined (reading 'displayName')" />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText(/Cannot read properties of undefined \(reading 'displayName'\)/),
    ).toBeInTheDocument();
  });

  it('keeps the reason collapsed behind a summary', () => {
    // Open by default would make every crash look like a stack trace, which is the thing the
    // friendly copy exists to avoid.
    const { container } = render(
      <ErrorBoundary>
        <Boom why="kaboom" />
      </ErrorBoundary>,
    );
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('What broke')).toBeInTheDocument();
  });

  it('offers a way out that is not the page that just crashed', () => {
    render(
      <ErrorBoundary>
        <Boom why="kaboom" />
      </ErrorBoundary>,
    );
    // Reloading a crashing route lands you back on the crash, so the link goes home.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });

  it('still says something when the error carries no message', () => {
    render(
      <ErrorBoundary>
        <Boom why="" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Well, that broke.')).toBeInTheDocument();
  });
});
