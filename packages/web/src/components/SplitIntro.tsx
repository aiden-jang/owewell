import type { ReactNode } from 'react';
import { ReceiptArt } from './ReceiptArt';

export function SplitIntro(): ReactNode {
  return (
    <section className="split-intro mb-9 lg:sticky lg:top-24 lg:mb-0">
      <p className="owewell-eyebrow">GOOD COMPANY. CLEAR TABS.</p>
      <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
        Split the bill.
        <br />
        Keep the friends.
      </h1>
      <p className="mt-5 max-w-[38ch] text-base text-muted">
        Add the people and what you spent. We’ll work out who owes who. Nobody came for the spreadsheet.
      </p>
      <ReceiptArt />
      <p className="text-sm text-muted">No account needed. Save your split when you want to keep it.</p>
      <p className="mt-6 text-sm font-medium text-muted lg:hidden">Start your split below ↓</p>
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
