import { formatMoney, type MoneyFormatter } from '@owewell/shared';

/*
 * How money renders. Dollars, everywhere.
 *
 * `useMoney()` reads no state — it is a plain function wearing a hook's name. Kept deliberately:
 * sixteen components ask it for a formatter instead of importing a global, so if a second currency
 * ever returns, only this file changes.
 */

/** Format cents as money. */
export function useMoney(): MoneyFormatter {
  return formatMoney;
}
