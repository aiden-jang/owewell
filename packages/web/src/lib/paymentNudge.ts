import type { MoneyFormatter } from '@owewell/shared';

export type NudgeTone = 'gentle' | 'direct' | 'playful';

export interface PaymentNudgeDetails {
  fromName: string;
  toName: string;
  amountCents: number;
  groupName: string;
  payUrl?: string | undefined;
}

/*
 * Written to sound like the person sending it, not like the app.
 *
 * These used to announce themselves: "a gentle owewell nudge for $24.50", "mark it paid in owewell".
 * Nobody texts a friend a sentence with the software's name in it twice, so the whole message read as
 * automated, which is the worst possible framing for asking somebody for money. It makes the ask feel
 * like a collections notice rather than a mate mentioning a thing.
 *
 * So: no product name in the sentence, no instructions about which app to open, and the pay link does
 * the work that the explaining used to. The tones differ in nerve, not in vocabulary.
 */
export function paymentNudgeText(details: PaymentNudgeDetails, tone: NudgeTone, fmt: MoneyFormatter): string {
  const amount = fmt(details.amountCents);
  const copy = tone === 'direct'
    ? `${details.fromName}, you still owe ${details.toName} ${amount} from ${details.groupName}. Send it over when you get a chance.`
    : tone === 'playful'
      ? `Tiny money ghost 👻 ${details.fromName} → ${details.toName}: ${amount} for ${details.groupName}. Exorcise it when you get a chance.`
      : `Hey ${details.fromName}, there's ${amount} left from ${details.groupName} whenever you get a sec. No rush.`;
  return details.payUrl ? `${copy}\nPay here: ${details.payUrl}` : copy;
}
