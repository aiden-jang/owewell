/*
 * What changed when somebody edited an expense.
 *
 * Editing overwrote in place and left no trace: any member could turn a $40 dinner into $80 and the
 * only evidence was everybody's balance moving. In an app about money between friends that is the same
 * trust problem the recurring rules already refuse to have, and the fix is the same shape. Corrections
 * stay easy — blocking them just makes people delete and re-add, which is strictly worse — but they
 * stop being invisible.
 */

export interface ExpenseSnapshot {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: string;
}

export type CorrectionField = 'amount' | 'description' | 'payer' | 'split';

/**
 * The fields that changed, in a fixed order.
 *
 * Only these four. A full diff would record the date, the category and the participant list too, which
 * is a lot of rows saying nothing: what a group needs to see is the number moving, who is owed, and how
 * it is carved up. Everything else is bookkeeping the payer can fix without anybody needing to know.
 */
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
 * One line describing a correction, in owewell's voice.
 *
 * Names the person and states the change, and stops. No "unauthorised", no warning colour, nothing
 * that reads as an accusation: the overwhelmingly common case is somebody fixing their own typo, and
 * copy that treats every edit as suspicious would make people avoid correcting real mistakes.
 *
 * The amount is the only field whose old value is shown, because it is the only one where "what was it
 * before" is the actual question. Formatting is the caller's, so this module stays currency-agnostic.
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
