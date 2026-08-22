import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { currencyFormatter, DEFAULT_CURRENCY, type MoneyFormatter } from '@owewell/shared';

/*
 * The currency the amounts on screen are in.
 *
 * Passed down rather than read from a module global, because "the current currency" is not a thing
 * that exists: the dashboard lists groups that can each count in something different, and a global
 * would render all of them in whichever group loaded last. A provider wraps one group's screen; the
 * dashboard formats each card with its own group's code instead.
 *
 * Outside a provider this is dollars, which is right for quick split (no group, no currency) and is
 * also what every existing group is.
 */
const CurrencyContext = createContext<{ code: string; fmt: MoneyFormatter }>({
  code: DEFAULT_CURRENCY,
  fmt: currencyFormatter(DEFAULT_CURRENCY),
});

export function CurrencyProvider({ code, children }: { code: string; children: ReactNode }): ReactNode {
  const value = useMemo(() => ({ code, fmt: currencyFormatter(code) }), [code]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/** Format cents in the surrounding group's currency. */
export function useMoney(): MoneyFormatter {
  return useContext(CurrencyContext).fmt;
}

/** The surrounding group's ISO code, for the rare caller that needs it (inputs, share text). */
export function useCurrencyCode(): string {
  return useContext(CurrencyContext).code;
}
