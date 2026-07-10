import { Money } from '@owewell/shared';
import type { SuggestedPayment } from '@owewell/core';

export interface GroupSummaryInput {
  groupName: string;
  memberCount: number;
  totalSpentCents: number;
  perPersonCents: number;
  totalSettledCents: number;
  /** The minimal set of transfers to square everyone up; empty means all settled. */
  suggested: SuggestedPayment[];
}

/**
 * Build the plain-text group summary shared via the native share sheet or clipboard. Kept as a
 * pure function so the exact wording is easy to eyeball and (later) test.
 */
export function buildGroupSummary(input: GroupSummaryInput): string {
  const { groupName, memberCount, totalSpentCents, perPersonCents, totalSettledCents, suggested } = input;
  const people = `${memberCount} ${memberCount === 1 ? 'person' : 'people'}`;
  const lines: string[] = [
    `${groupName} on owewell`,
    `${Money.fromCents(totalSpentCents).format()} in bills across ${people} (${Money.fromCents(perPersonCents).format()} each)`,
  ];
  if (totalSettledCents > 0) {
    lines.push(`${Money.fromCents(totalSettledCents).format()} settled so far`);
  }
  lines.push('');
  if (suggested.length === 0) {
    lines.push('All settled up. Nobody owes anybody.');
  } else {
    lines.push('Who owes who:');
    for (const p of suggested) {
      lines.push(`• ${p.fromName} → ${p.toName} ${Money.fromCents(p.amountCents).format()}`);
    }
  }
  return lines.join('\n');
}
