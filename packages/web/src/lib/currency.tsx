import { formatMoney, type MoneyFormatter } from '@owewell/shared';

/*
 * How money renders. Dollars, everywhere.
 *
 * This was a React context, because a group could count in any of twenty currencies and the
 * dashboard could list several at once — so "the current currency" was genuinely not a thing that
 * existed at module scope. With one currency it is, and a provider wrapping a constant is
 * indirection with nothing behind it.
 *
 * `useMoney()` survives the change on purpose. Sixteen components ask for a formatter rather than
 * importing a global, which is the seam currency would come back through: only this file would
 * change. It reads no state now, so it is a plain function wearing a hook's name — kept because the
 * call sites read correctly, not because it does anything.
 */

/** Format cents as money. */
export function useMoney(): MoneyFormatter {
  return formatMoney;
}
