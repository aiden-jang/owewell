import { Money } from './money.js';

/**
 * How money reads. Dollars, everywhere.
 *
 * A per-group currency was removed. Doing it properly needs minor-unit scale in Money (yen has none,
 * so a stored unit would be a hundredth of a yen and an even split of ¥1,000 would display three
 * amounts summing to ¥1,001) plus a rate and a date to restate a ledger people already agreed on.
 * A picker that only relabels is worse than one currency.
 */
export type MoneyFormatter = (cents: number) => string;

/** Passed around as a value rather than imported, so the seam survives if currencies come back. */
export const formatMoney: MoneyFormatter = (cents) => Money.fromCents(cents).format();

/**
 * Just the symbol, for prefixing an input somebody is typing into.
 *
 * Used on the two hero amount fields — add an expense, log a payment — and deliberately not on the
 * seven small inline ones: per-item amounts, tax, tip, per-person exact splits. Nine `$` marks in a
 * dense itemized list is noise, and a column of right-aligned figures under a heading about money
 * is not ambiguous. The rule is that the symbol marks the field a form is *about*, not every
 * field that happens to hold money.
 */
export function currencySymbol(): string {
  return '$';
}
