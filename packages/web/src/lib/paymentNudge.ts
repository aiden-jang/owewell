import type { MoneyFormatter } from '@owewell/shared';

export type NudgeTone = 'gentle' | 'direct' | 'playful';

export interface PaymentNudgeDetails {
  fromName: string;
  toName: string;
  amountCents: number;
  groupName: string;
  payUrl?: string | undefined;
}

// Shared requests speak for the sender; keep app branding and automated instructions out of them.
export function paymentNudgeText(details: PaymentNudgeDetails, tone: NudgeTone, fmt: MoneyFormatter): string {
  const amount = fmt(details.amountCents);
  const copy =
    tone === 'direct'
      ? `${details.fromName}, you still owe ${details.toName} ${amount} from ${details.groupName}. Send it over when you get a chance.`
      : tone === 'playful'
        ? `Tiny money ghost 👻 ${details.fromName} → ${details.toName}: ${amount} for ${details.groupName}. Exorcise it when you get a chance.`
        : `Hey ${details.fromName}, there's ${amount} left from ${details.groupName} whenever you get a sec. No rush.`;
  return details.payUrl ? `${copy}\nPay here: ${details.payUrl}` : copy;
}
