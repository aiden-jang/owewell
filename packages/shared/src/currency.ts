import { Money } from './money.js';

// All stored amounts are USD cents; changing the display label does not convert a ledger.
export type MoneyFormatter = (cents: number) => string;

export const formatMoney: MoneyFormatter = (cents) => Money.fromCents(cents).format();

export function currencySymbol(): string {
  return '$';
}
