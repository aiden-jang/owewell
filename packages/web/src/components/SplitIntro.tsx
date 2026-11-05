import type { ReactNode } from 'react';
import { ReceiptArt } from './ReceiptArt';

export function SplitIntro({ onExample }: { onExample?: (() => void) | undefined }): ReactNode {
  return (
    <section className="split-intro">
      <div className="split-intro-copy">
        <h1 className="font-display font-semibold tracking-tight">
          Split the bill.
          <br />
          <span>Keep the peace.</span>
        </h1>
        <p>Dinner, rent, the suspiciously expensive weekend. Work out everyone’s share, right here.</p>
        <div className="split-intro-actions">
          <a href="#split-bill" className="split-start">
            Let’s split it ↓
          </a>
          {onExample && (
            <button type="button" className="split-example" onClick={onExample}>
              Try a $48 example ↗
            </button>
          )}
        </div>
        <p className="split-aside">No account required. Just a mildly awkward amount of money.</p>
      </div>
      <div className="split-intro-art" aria-hidden="true">
        <ReceiptArt />
        <span>friendship, balanced.</span>
      </div>
    </section>
  );
}

export function DashboardIntro(): ReactNode {
  return (
    <div className="dashboard-intro">
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Your tabs</h1>
        <p className="mt-2 text-sm text-muted">Good friends. Occasionally complicated arithmetic.</p>
      </div>
      <ReceiptArt />
    </div>
  );
}
