import type { ReactNode } from 'react';
import { ReceiptArt } from './ReceiptArt';

export function SplitIntro({ onExample }: { onExample?: (() => void) | undefined }): ReactNode {
  return (
    <section className="split-intro">
      <p className="owewell-eyebrow">THE BILL, PLEASE.</p>
      <h1 className="font-display font-semibold tracking-tight">
        Dinner’s over.
        <br />
        Math isn’t.
      </h1>
      <p>Add your people, then the bill. The answer updates as you go.</p>
      <p>No account needed. No one has to pretend they enjoyed the calamari.</p>
      {onExample && (
        <button type="button" className="split-example" onClick={onExample}>
          Try a $48 example ↗
        </button>
      )}
      <ol className="split-steps">
        <li>
          <span>01</span> Who was there?
        </li>
        <li>
          <span>02</span> What did you spend?
        </li>
        <li>
          <span>03</span> The answer.
        </li>
      </ol>
    </section>
  );
}

export function DashboardIntro(): ReactNode {
  return (
    <div className="dashboard-intro">
      <div>
        <p className="owewell-eyebrow">YOUR SHARED SPENDING</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">The tabs, kept.</h1>
        <p className="mt-2 text-sm text-muted">Good friends. Occasionally complicated arithmetic.</p>
      </div>
      <ReceiptArt />
    </div>
  );
}
