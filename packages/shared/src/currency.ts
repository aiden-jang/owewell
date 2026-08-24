import { Money } from './money.js';

/**
 * How money reads. Dollars, everywhere.
 *
 * There used to be a per-group currency and a list of twenty codes behind it. It is gone, and not
 * because it was hard: a real one needs minor-unit scale in Money (yen and won have none, so a
 * stored unit would be a hundredth of a yen that nobody can pay, and an even three-way split of
 * ¥1,000 would display three amounts summing to ¥1,001), and it needs a rate and a date to change
 * a ledger the group has already agreed on. A picker that only relabels is worse than one currency.
 */

export type MoneyFormatter = (cents: number) => string;

/** Passed around as a value rather than imported, so the seam survives if currencies come back. */
export const formatMoney: MoneyFormatter = (cents) => Money.fromCents(cents).format();

/** Just the symbol, for prefixing an input the user is typing into. */
export function currencySymbol(): string {
  return '$';
}
