import {
  computeItemizedSplit,
  dollarsToCents,
  formatMoney,
  type SplitMethod,
  type SplitShare,
} from '@owewell/shared';

export function expenseShareCaption(
  method: SplitMethod,
  shares: readonly SplitShare[] | null,
  count: number,
  viewerId: string | undefined,
  editing: boolean,
): string {
  const ways = `${count} ${count === 1 ? 'way' : 'ways'}`;
  if (!shares) return `Split ${ways}`;
  const own = shares.find((share) => share.userId === viewerId);
  if (method === 'EQUAL') {
    const amounts = shares.map(({ owedCents }) => owedCents);
    const low = Math.min(...amounts);
    const high = Math.max(...amounts);
    const range = low === high ? formatMoney(low) : `${formatMoney(low)}–${formatMoney(high)}`;
    if (!viewerId) return `${range} each · split ${ways}`;
    const portion = own && !editing ? range : formatMoney(own?.owedCents ?? 0);
    return `Your share ${portion} · split ${ways}`;
  }
  if (!viewerId) return `Split ${ways}`;
  const estimate = own && !editing && method !== 'EXACT' ? ' · about' : '';
  return `Your share${estimate} ${formatMoney(own?.owedCents ?? 0)} · split ${ways}`;
}

function previewCents(value: string): number | null {
  if (!value.trim()) return 0;
  try {
    const cents = dollarsToCents(value);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  } catch {
    return null;
  }
}

export function receiptSharePreview(
  items: readonly { amount: string; participantIds: ReadonlySet<string> }[],
  tax: string,
  tip: string,
  members: ReadonlySet<string>,
  viewerId?: string,
  seed?: string,
) {
  const lines = items.map(({ amount, participantIds }) => ({
    amountCents: previewCents(amount),
    participantIds: [...participantIds].filter((id) => members.has(id)),
  }));
  const taxCents = previewCents(tax);
  const tipCents = previewCents(tip);
  const totalCents = lines.reduce(
    (sum, line) => sum + (line.amountCents ?? 0),
    (taxCents ?? 0) + (tipCents ?? 0),
  );
  if (!Number.isSafeInteger(totalCents)) return { totalCents: null, caption: null };
  if (
    !viewerId ||
    taxCents === null ||
    tipCents === null ||
    !lines.every((line) => line.amountCents && line.participantIds.length)
  ) {
    return { totalCents, caption: null };
  }
  const shares = computeItemizedSplit({
    items: lines.map((line) => ({ ...line, amountCents: line.amountCents! })),
    taxCents,
    tipCents,
    ...(seed ? { seed } : {}),
  });
  const own = shares.find((share) => share.userId === viewerId);
  const estimate = own && !seed ? ' · about' : '';
  return { totalCents, caption: `Your share${estimate} ${formatMoney(own?.owedCents ?? 0)}` };
}
