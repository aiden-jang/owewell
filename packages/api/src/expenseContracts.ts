import type { SplitMethod } from '@owewell/shared';

export type ExpenseErrorCode =
  'INVALID_PAYER' | 'INVALID_PARTICIPANT' | 'INVALID_SPLIT' | 'NOT_FOUND' | 'LOCKED' | 'CONFLICT';

export class ExpenseError extends Error {
  constructor(
    readonly code: ExpenseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export interface CreateExpenseInput {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  participants: { userId: string; value?: number }[];
  /** Spend category key. Omit to default to "other". */
  category?: string | undefined;
  /** Optional free text: why this cost what it did. Omit or null to clear. */
  note?: string | null | undefined;
  /**
   * Client-chosen id, so a create that is retried after a dropped connection is recognised rather
   * than duplicated. Omit for writes that cannot be replayed.
   */
  clientId?: string | undefined;
  /**
   * The version this edit was written against. Omit to overwrite whatever is there now, which is
   * what "apply mine anyway" does after a conflict has been shown to a person.
   */
  expectedVersion?: number | undefined;
  /** The date the expense happened (backdatable). Omit to use "now". */
  date?: Date;
  /** Use the preview seed to preserve its odd-cent allocation when the expense is saved. */
  splitSeed?: string;
}

export interface CreateItemizedExpenseInput {
  description: string;
  payerId: string;
  taxCents: number;
  tipCents: number;
  items: { name: string; amountCents: number; participantIds: string[]; payerId?: string | undefined }[];
  category?: string | undefined;
  /** Optional free text: why this cost what it did. Omit or null to clear. */
  note?: string | null | undefined;
  /** Client-chosen id, so a retried create is recognised rather than duplicated. */
  clientId?: string | undefined;
  /** The version this edit was written against. Omit to overwrite unconditionally. */
  expectedVersion?: number | undefined;
  date?: Date;
}

export interface ExpenseView {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: string;
  category: string | null;
  createdAt: Date;
  /** The effective expense date (user-set date, else createdAt). Drives feed order + display. */
  date: Date;
  /** Optional free text from whoever entered it. Null when they didn't write one. */
  note: string | null;
  /** Bumped on every edit. Hand it back on an edit to be told when the row has moved on. */
  version: number;
  splits: { userId: string; owedCents: number; inputValue?: number | null }[];
  // Present only for ITEMIZED expenses, so the edit form can prefill the receipt.
  taxCents?: number;
  tipCents?: number;
  items?: { name: string; amountCents: number; participantIds: string[] }[];
  /** The most recent correction, when there has been one. Older ones stay in the table, unread. */
  lastEdit?: { at: Date; byId: string; fields: string[]; formerAmountCents: number };
}
