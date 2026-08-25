import { describe, expect, it } from 'vitest';
import { payLinks, preferredMethod } from './payLinks';

const payee = (
  over: Partial<{ venmoHandle: string; cashappCashtag: string; paypalHandle: string }> = {},
) => ({
  venmoHandle: over.venmoHandle ?? null,
  cashappCashtag: over.cashappCashtag ?? null,
  paypalHandle: over.paypalHandle ?? null,
});

describe('payLinks', () => {
  it('builds one link per handle, with the amount in dollars', () => {
    const links = payLinks(
      payee({ venmoHandle: 'alex', cashappCashtag: 'alexc', paypalHandle: 'alexp' }),
      2450,
      'owewell: Trip',
    );
    expect(links.map((l) => l.label)).toEqual(['Venmo', 'Cash App', 'PayPal']);
    expect(links.map((l) => l.method)).toEqual(['venmo', 'cashapp', 'paypal']);

    const venmo = links.find((l) => l.label === 'Venmo')!;
    expect(venmo.url).toContain('venmo.com/alex');
    expect(venmo.url).toContain('txn=pay');
    expect(venmo.url).toContain('amount=24.50');
    expect(venmo.url).toContain('note='); // only Venmo carries a note

    expect(links.find((l) => l.label === 'Cash App')!.url).toBe('https://cash.app/$alexc/24.50');
    expect(links.find((l) => l.label === 'PayPal')!.url).toBe('https://paypal.me/alexp/24.50');
  });

  it('returns nothing and reports no pay link when the payee has no handles', () => {
    expect(payLinks(payee(), 1000, 'x')).toEqual([]);
  });

  it('formats sub-dollar and round amounts correctly', () => {
    expect(payLinks(payee({ cashappCashtag: 'c' }), 5, 'x')[0]!.url).toBe('https://cash.app/$c/0.05');
    expect(payLinks(payee({ cashappCashtag: 'c' }), 1000, 'x')[0]!.url).toBe('https://cash.app/$c/10.00');
  });
});

describe('preferredMethod', () => {
  it('prefers Venmo, then Cash App, then PayPal', () => {
    expect(preferredMethod(payee({ venmoHandle: 'v', cashappCashtag: 'c', paypalHandle: 'p' }))).toBe(
      'venmo',
    );
    expect(preferredMethod(payee({ cashappCashtag: 'c', paypalHandle: 'p' }))).toBe('cashapp');
    expect(preferredMethod(payee({ paypalHandle: 'p' }))).toBe('paypal');
  });

  it('returns null when there is no handle or no payee', () => {
    expect(preferredMethod(payee())).toBeNull();
    expect(preferredMethod(null)).toBeNull();
    expect(preferredMethod(undefined)).toBeNull();
  });
});
