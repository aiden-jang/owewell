import type { GroupMember } from '@owewell/core';

export interface PayLink {
  label: string;
  url: string;
}

type Payee = Pick<GroupMember, 'venmoHandle' | 'cashappCashtag' | 'paypalHandle'>;

const dollars = (cents: number): string => (cents / 100).toFixed(2);

/** True when the payee has at least one payment handle we can build a link for. */
export function hasPayLink(payee: Payee): boolean {
  return Boolean(payee.venmoHandle || payee.cashappCashtag || payee.paypalHandle);
}

/**
 * Build "pay <payee>" deep links for a settlement amount, one per handle the
 * payee has set. The amount is prefilled; the payer confirms in the payment app.
 * Only Venmo's link carries a note. owewell never touches money — these just
 * hand off to the payer's app of choice.
 */
export function payLinks(payee: Payee, amountCents: number, note: string): PayLink[] {
  const amt = dollars(amountCents);
  const links: PayLink[] = [];

  if (payee.venmoHandle) {
    const u = new URL(`https://venmo.com/${encodeURIComponent(payee.venmoHandle)}`);
    u.searchParams.set('txn', 'pay');
    u.searchParams.set('amount', amt);
    if (note) u.searchParams.set('note', note);
    links.push({ label: 'Venmo', url: u.toString() });
  }
  if (payee.cashappCashtag) {
    links.push({ label: 'Cash App', url: `https://cash.app/$${encodeURIComponent(payee.cashappCashtag)}/${amt}` });
  }
  if (payee.paypalHandle) {
    links.push({ label: 'PayPal', url: `https://paypal.me/${encodeURIComponent(payee.paypalHandle)}/${amt}` });
  }
  return links;
}
