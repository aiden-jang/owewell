import { Money } from '@owewell/shared';

export type NudgeTone = 'gentle' | 'direct' | 'playful';

export interface PaymentNudgeDetails {
  fromName: string;
  toName: string;
  amountCents: number;
  groupName: string;
  payUrl?: string | undefined;
}

export function paymentNudgeText(details: PaymentNudgeDetails, tone: NudgeTone): string {
  const amount = Money.fromCents(details.amountCents).format();
  const copy = tone === 'direct'
    ? `${details.fromName}, you still owe ${details.toName} ${amount} for ${details.groupName}. Please send it when you can and mark it paid in owewell.`
    : tone === 'playful'
      ? `Tiny money ghost 👻 ${details.fromName} → ${details.toName}: ${amount} for ${details.groupName}. Exorcise it when you get a chance.`
      : `Hey ${details.fromName} — a gentle owewell nudge for ${amount} to ${details.toName} in ${details.groupName}. No rush, just keeping the group square.`;
  return details.payUrl ? `${copy}\nPay here: ${details.payUrl}` : copy;
}
