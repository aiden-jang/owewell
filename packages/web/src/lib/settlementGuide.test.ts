import { describe, expect, it } from 'vitest';
import type { Balance } from './groups';
import type { SuggestedPayment } from './settlements';
import { bestSettlementStep, projectBalancesAfterPayment, settlementStepImpact } from './settlementGuide';

const balance = (userId: string, displayName: string, netCents: number): Balance => ({
  userId,
  displayName,
  netCents,
  paidCents: 0,
  owedCents: 0,
});
const payment = (fromUserId: string, fromName: string, toUserId: string, toName: string, amountCents: number): SuggestedPayment => ({
  fromUserId,
  fromName,
  toUserId,
  toName,
  amountCents,
});

describe('settlementStepImpact', () => {
  it('shows who becomes square and how much work remains', () => {
    const balances = [balance('a', 'Alex', -8000), balance('b', 'Blair', -2000), balance('c', 'Casey', 5000), balance('d', 'Dev', 5000)];
    const suggestions = [payment('a', 'Alex', 'c', 'Casey', 5000), payment('b', 'Blair', 'd', 'Dev', 2000), payment('a', 'Alex', 'd', 'Dev', 3000)];
    expect(settlementStepImpact(suggestions[1]!, balances, suggestions)).toMatchObject({
      clearedNames: ['Blair'],
      remainingCents: 8000,
      remainingTransfers: 2,
      percentOfOutstanding: 20,
    });
  });

  it('recognizes one payment that settles both sides and the whole group', () => {
    const balances = [balance('a', 'Alex', -4250), balance('b', 'Blair', 4250)];
    const suggestions = [payment('a', 'Alex', 'b', 'Blair', 4250)];
    expect(settlementStepImpact(suggestions[0]!, balances, suggestions)).toMatchObject({
      clearedNames: ['Alex', 'Blair'],
      remainingCents: 0,
      remainingTransfers: 0,
      percentOfOutstanding: 100,
    });
  });

  it('disambiguates two people with the same display name', () => {
    const balances = [balance('a', 'Alex', -1000), balance('b', 'Alex', 1000)];
    const suggestions = [payment('a', 'Alex', 'b', 'Alex', 1000)];
    expect(settlementStepImpact(suggestions[0]!, balances, suggestions).clearedNames).toEqual([
      'Alex (payer)',
      'Alex (recipient)',
    ]);
  });
});

describe('bestSettlementStep', () => {
  it('prefers clearing two balances over merely moving more money', () => {
    const balances = [balance('a', 'Alex', -8000), balance('b', 'Blair', -2000), balance('c', 'Casey', 8000), balance('d', 'Dev', 2000)];
    const suggestions = [payment('a', 'Alex', 'c', 'Casey', 5000), payment('b', 'Blair', 'd', 'Dev', 2000)];
    expect(bestSettlementStep(balances, suggestions)?.payment.fromUserId).toBe('b');
  });

  it('uses the larger payment when two choices clear the same number of balances', () => {
    const balances = [balance('a', 'Alex', -6000), balance('b', 'Blair', -4000), balance('c', 'Casey', 6000), balance('d', 'Dev', 4000)];
    const suggestions = [payment('b', 'Blair', 'd', 'Dev', 4000), payment('a', 'Alex', 'c', 'Casey', 6000)];
    expect(bestSettlementStep(balances, suggestions)?.payment.amountCents).toBe(6000);
    expect(bestSettlementStep(balances, [])).toBeNull();
  });
});

describe('projectBalancesAfterPayment', () => {
  it('shows the payer and recipient balances after the suggested transfer', () => {
    const balances = [
      balance('a', 'Alex', -8000),
      balance('b', 'Blair', 5000),
      balance('c', 'Casey', 3000),
    ];

    expect(projectBalancesAfterPayment(payment('a', 'Alex', 'b', 'Blair', 5000), balances)).toEqual([
      {
        userId: 'a',
        displayName: 'Alex',
        beforeCents: -8000,
        afterCents: -3000,
        becomesSettled: false,
      },
      {
        userId: 'b',
        displayName: 'Blair',
        beforeCents: 5000,
        afterCents: 0,
        becomesSettled: true,
      },
    ]);
  });

  it('does not mutate the source balances', () => {
    const balances = [balance('a', 'Alex', -2500), balance('b', 'Blair', 2500)];
    projectBalancesAfterPayment(payment('a', 'Alex', 'b', 'Blair', 2500), balances);
    expect(balances.map(entry => entry.netCents)).toEqual([-2500, 2500]);
  });
});
