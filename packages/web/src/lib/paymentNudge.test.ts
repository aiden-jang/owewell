import { describe, expect, it } from 'vitest';
import { paymentNudgeText } from './paymentNudge';
import { formatMoney } from '@owewell/shared';

const usd = formatMoney;

const details = {
  fromName: 'Alex',
  toName: 'Blair',
  amountCents: 2450,
  groupName: 'Beach weekend',
};

describe('paymentNudgeText', () => {
  it('keeps the gentle version human and low pressure', () => {
    expect(paymentNudgeText(details, 'gentle', usd)).toBe(
      "Hey Alex, there's $24.50 left from Beach weekend whenever you get a sec. No rush.",
    );
  });

  it('offers direct and playful versions without changing the facts', () => {
    expect(paymentNudgeText(details, 'direct', usd)).toContain('you still owe Blair $24.50');
    expect(paymentNudgeText(details, 'playful', usd)).toContain('Alex → Blair: $24.50');
  });

  it('adds a payment deep link when the recipient has one configured', () => {
    expect(paymentNudgeText({ ...details, payUrl: 'https://pay.example/blair' }, 'gentle', usd))
      .toContain('\nPay here: https://pay.example/blair');
  });
});
