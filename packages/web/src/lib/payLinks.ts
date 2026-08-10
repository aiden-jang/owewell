import type { GroupMember, PaymentMethod } from '@owewell/core';

export interface PayLink {
  label: string;
  url: string;
  /** The ledger label that matches the app this link opens. */
  method: Extract<PaymentMethod, 'venmo' | 'cashapp' | 'paypal'>;
}

type Payee = Pick<GroupMember, 'venmoHandle' | 'cashappCashtag' | 'paypalHandle'>;

/**
 * The payment method to default to when settling up with a payee: the app they've set a handle
 * for, so recording a payment pre-selects how they actually get paid. Null when they have none
 * (caller falls back to cash). Venmo > Cash App > PayPal when several are set.
 */
export function preferredMethod(payee: Payee | null | undefined): PaymentMethod | null {
  if (!payee) return null;
  if (payee.venmoHandle) return 'venmo';
  if (payee.cashappCashtag) return 'cashapp';
  if (payee.paypalHandle) return 'paypal';
  return null;
}

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
    links.push({ label: 'Venmo', url: u.toString(), method: 'venmo' });
  }
  if (payee.cashappCashtag) {
    links.push({ label: 'Cash App', url: `https://cash.app/$${encodeURIComponent(payee.cashappCashtag)}/${amt}`, method: 'cashapp' });
  }
  if (payee.paypalHandle) {
    links.push({ label: 'PayPal', url: `https://paypal.me/${encodeURIComponent(payee.paypalHandle)}/${amt}`, method: 'paypal' });
  }
  return links;
}
