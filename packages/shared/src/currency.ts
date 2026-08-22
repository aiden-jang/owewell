import { Money } from './money.js';

/**
 * Which currency a group counts in.
 *
 * Everything in this app is stored as an integer number of a currency's MINOR unit, so the list below
 * is deliberately limited to currencies with exactly two decimal places. Yen and won have none: one
 * stored unit would be a hundredth of a yen, which nobody can pay and which the splitter would happily
 * allocate anyway, so an even split of ¥1,000 three ways would display as three amounts that add up to
 * ¥1,001 once each was rounded for display. Adding those means teaching Money about minor-unit scale,
 * not adding a row here.
 */
export const CURRENCIES = [
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British pound' },
  { code: 'CAD', label: 'Canadian dollar' },
  { code: 'AUD', label: 'Australian dollar' },
  { code: 'NZD', label: 'New Zealand dollar' },
  { code: 'CHF', label: 'Swiss franc' },
  { code: 'SEK', label: 'Swedish krona' },
  { code: 'NOK', label: 'Norwegian krone' },
  { code: 'DKK', label: 'Danish krone' },
  { code: 'PLN', label: 'Polish złoty' },
  { code: 'CZK', label: 'Czech koruna' },
  { code: 'MXN', label: 'Mexican peso' },
  { code: 'BRL', label: 'Brazilian real' },
  { code: 'ZAR', label: 'South African rand' },
  { code: 'INR', label: 'Indian rupee' },
  { code: 'SGD', label: 'Singapore dollar' },
  { code: 'HKD', label: 'Hong Kong dollar' },
  { code: 'THB', label: 'Thai baht' },
  { code: 'TRY', label: 'Turkish lira' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

const CODES = new Set<string>(CURRENCIES.map((c) => c.code));

/** True for currencies this app can hold without inventing a sub-unit nobody can pay. */
export function isSupportedCurrency(code: string): code is CurrencyCode {
  return CODES.has(code);
}

/** Fall back rather than throw: a row written by a future version should still render. */
export function asCurrency(code: string | null | undefined): CurrencyCode {
  return code && isSupportedCurrency(code) ? code : DEFAULT_CURRENCY;
}

export type MoneyFormatter = (cents: number) => string;

/**
 * One formatter per currency, handed down instead of read from a global.
 *
 * The dashboard lists groups that can each count in something different, so "the current currency"
 * is not a thing that exists at module scope. Callers that render one group's money take one of
 * these; callers that render several make one per group.
 */
export function currencyFormatter(code: string): MoneyFormatter {
  const currency = asCurrency(code);
  return (cents: number) => Money.fromCents(cents).format({ currency });
}

/** Just the symbol ("$", "€", "kr"), for prefixing an input the user is typing into. */
export function currencySymbol(code: string): string {
  const currency = asCurrency(code);
  const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? '$';
}
