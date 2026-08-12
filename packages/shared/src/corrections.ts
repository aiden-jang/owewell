/*
 * Editing overwrote in place: a $40 dinner could become $80 with no evidence but a moved balance.
 * Corrections stay easy (blocking them just makes people delete and re-add) but stop being invisible.
 */

export interface ExpenseSnapshot {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: string;
}

export type CorrectionField = 'amount' | 'description' | 'payer' | 'split';

/** Four fields, fixed order. A full diff would log date and category changes too, which is a lot of
 *  rows saying nothing: what matters is the number, who is owed, and how it is carved up. */
export function changedFields(before: ExpenseSnapshot, after: ExpenseSnapshot): CorrectionField[] {
  const changed: CorrectionField[] = [];
  if (before.amountCents !== after.amountCents) changed.push('amount');
  if (before.description.trim() !== after.description.trim()) changed.push('description');
  if (before.payerId !== after.payerId) changed.push('payer');
  if (before.splitMethod !== after.splitMethod) changed.push('split');
  return changed;
}

/** Whether this edit is worth a row at all. Re-saving a form unchanged is not a correction. */
export function isCorrection(before: ExpenseSnapshot, after: ExpenseSnapshot): boolean {
  return changedFields(before, after).length > 0;
}

/**
 * Names the person, states the change, stops. Nothing that reads as an accusation: almost every edit is
 * somebody fixing their own typo, and suspicious copy stops people correcting real mistakes.
 *
 * Only the amount shows its old value, since that is the only one where "what was it" is the question.
 */
export function correctionLine(
  fields: readonly CorrectionField[],
  editorName: string,
  formerAmount: string | null,
): string {
  if (fields.length === 0) return `${editorName} edited this.`;
  if (fields.includes('amount') && formerAmount) {
    const rest = fields.filter((field) => field !== 'amount');
    const also = rest.length > 0 ? `, and the ${listOf(rest)}` : '';
    return `${editorName} changed the amount from ${formerAmount}${also}.`;
  }
  return `${editorName} changed the ${listOf(fields)}.`;
}

function listOf(fields: readonly CorrectionField[]): string {
  const names = fields.map((field) => (field === 'payer' ? 'payer' : field === 'split' ? 'split' : field));
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
