import { computeSplit, dollarsToCents, quickSplitSeed, simplifyDebts } from '@owewell/shared';
import type { Transfer } from '@owewell/shared';
import type { DraftItem, DraftPerson } from './quickSplitDraft';
import { serverValue } from './splitValues';

// Incomplete input is normal while typing; return no preview until it can be calculated.

export interface QuickSplitResult {
  /** A short list of transfers that settles it, or null until at least one item has a usable amount. */
  transfers: Transfer[] | null;
  /** Everything entered so far, in cents. */
  grandTotal: number;
  /**
   * What it cost the person holding the phone.
   *
   * The transfer list can never show this: it only names people who owe somebody, so whoever paid
   * is absent from it entirely and the one number they came for is left to be worked out by hand.
   */
  yourShareCents: number | null;
  /** Everyone's share, so a caller can read the shape of the split. */
  sharesByPerson: Record<string, number> | null;
  /** Resolved from the selection, falling back to the first named person. */
  effectivePayerId: string;
  effectiveYouId: string;
  /** People with a name — the only ones who can be in a split. */
  named: DraftPerson[];
}

export function computeQuickSplit(input: {
  people: DraftPerson[];
  items: DraftItem[];
  payerId: string;
  youId: string;
  splitPayers: boolean;
}): QuickSplitResult {
  const { people, items, payerId, youId, splitPayers } = input;
  const named = people.filter((p) => p.name.trim());

  /*
   * Both must resolve to somebody actually in the split, so a blank or since-removed selection
   * cannot make Save fail with "Pick who paid" while a payer radio still looks chosen.
   */
  const effectivePayerId = payerId && named.some((p) => p.id === payerId) ? payerId : (named[0]?.id ?? '');
  const effectiveYouId =
    youId && named.some((p) => p.id === youId) ? youId : (named[0]?.id ?? people[0]?.id ?? '');

  const empty: QuickSplitResult = {
    transfers: null,
    grandTotal: 0,
    yourShareCents: null,
    sharesByPerson: null,
    effectivePayerId,
    effectiveYouId,
    named,
  };

  let grandTotal = 0;
  try {
    const owed: Record<string, number> = Object.fromEntries(named.map((p) => [p.id, 0]));
    const paid: Record<string, number> = Object.fromEntries(named.map((p) => [p.id, 0]));
    let any = false;
    /*
     * Counts only the items that will actually be sent, because the save path drops blank ones and
     * the server seeds by position in what it receives. Using the raw array index would put the odd
     * cent somewhere else the moment any item above it was left empty.
     */
    let sentIndex = 0;

    for (const item of items) {
      const amountCents = item.amount.trim() ? dollarsToCents(item.amount) : 0;
      if (amountCents <= 0 || named.length === 0) continue;

      const shares = computeSplit(
        item.method,
        amountCents,
        named.map((p) => {
          const value = serverValue(item.method, item.values[p.id] ?? '');
          return value === undefined ? { userId: p.id } : { userId: p.id, value };
        }),
        quickSplitSeed(sentIndex),
      );
      sentIndex += 1;
      for (const share of shares) owed[share.userId] = (owed[share.userId] ?? 0) + share.owedCents;

      // A per-item payer who is not a named participant falls back to the default payer, exactly as
      // the save path does, so the preview cannot diverge from the result.
      const raw = splitPayers && item.payerId ? item.payerId : effectivePayerId;
      const itemPayer = paid[raw] !== undefined ? raw : effectivePayerId;
      paid[itemPayer] = (paid[itemPayer] ?? 0) + amountCents;

      grandTotal += amountCents;
      any = true;
    }

    if (!any) return { ...empty, grandTotal };

    // Net each person, then derive the settlement transfers — the same math the saved group shows.
    const transfers = simplifyDebts(
      named.map((p) => ({ userId: p.id, netCents: (paid[p.id] ?? 0) - (owed[p.id] ?? 0) })),
    );
    return {
      transfers,
      grandTotal,
      yourShareCents: owed[effectiveYouId] ?? null,
      sharesByPerson: owed,
      effectivePayerId,
      effectiveYouId,
      named,
    };
  } catch {
    return empty;
  }
}
