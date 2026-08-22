// owewell's domain contract: the JSON shapes and constants exchanged between the API and the
// web app. Framework-free and money-representation-free (amounts are integer cents; splitting
// math lives in @owewell/shared). Timestamps are ISO strings, i.e. the wire form of the
// server's Date values. Keeping this in one package is what stops the two sides from drifting.

import type { SplitMethod } from '@owewell/shared';

export { SPLIT_METHODS } from '@owewell/shared';
export type { SplitMethod };

/** How a settlement was actually paid. Tag-only (no deep links), surfaced in the activity feed. */
export const PAYMENT_METHODS = ['venmo', 'paypal', 'cashapp', 'apple_cash', 'zelle', 'cash', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Human-friendly labels for each payment method (for pickers + the activity feed). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  venmo: 'Venmo',
  paypal: 'PayPal',
  cashapp: 'Cash App',
  apple_cash: 'Apple Cash',
  zelle: 'Zelle',
  cash: 'Cash',
  other: 'Other',
};

// --- Groups -----------------------------------------------------------------

export type GroupRole = 'OWNER' | 'MEMBER';

export interface GroupMember {
  userId: string;
  displayName: string;
  /** Null for name-only placeholders that aren't linked to a real account yet. */
  email: string | null;
  role: GroupRole;
  joinedAt: string;
  /** True for name-only members (no linked account). Only these can be renamed locally. */
  isPlaceholder: boolean;
  /** Payment handles (without @ / $), used to build settle-up deep links. Null when unset. */
  venmoHandle: string | null;
  cashappCashtag: string | null;
  paypalHandle: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: string;
  /** Archived groups stay in the ledger but drop off the active list. */
  archived: boolean;
  memberCount: number;
  /** The viewer's net in this group. Positive: they're owed. Negative: they owe. */
  netCents: number;
  /** The whole group's outstanding money (sum of every positive balance), not just the viewer's. */
  totalUnsettledCents: number;
  /** Total spent on expenses in this group. 0 means no expenses yet (distinct from settled). */
  totalSpentCents: number;
  /**
   * ISO timestamp of the newest expense or settlement, falling back to when the group was made.
   * "Created 8 months ago" is trivia; "nothing since March" is what says a group is finished.
   */
  lastActivityAt: string;
  /** Whether the viewer owns this group (only owners can delete it). */
  isOwner: boolean;
  /** ISO 4217 code this group counts in. Per group: the dashboard can list several at once. */
  currency: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  createdById: string;
  createdAt: string;
  archived: boolean;
  /** Shared owner-set finish line for outstanding payments. */
  settleBy: string | null;
  /** Shared owner-set spending target for the group, in cents. Null for the groups that never set one. */
  budgetCents: number | null;
  /** ISO 4217 code the group counts in. Amounts are integer minor units of it. */
  currency: string;
  members: GroupMember[];
}

export interface Balance {
  userId: string;
  displayName: string;
  netCents: number;
  /** What they paid on bills, excluding settlements. */
  paidCents: number;
  /** Their share of the bills, excluding settlements. */
  owedCents: number;
}

// --- Expenses ---------------------------------------------------------------

/** Persisted expenses also carry the itemized method, which isn't a user-chosen split rule. */
export type ExpenseSplitMethod = SplitMethod | 'ITEMIZED';

export interface ExpenseSplit {
  userId: string;
  owedCents: number;
  /**
   * The value the payer originally entered for this participant under the split method
   * (EXACT: cents, PERCENT: basis points, SHARES: weight; null for EQUAL/ITEMIZED). Lets the
   * edit form prefill faithfully rather than reverse-engineering it from owedCents.
   */
  inputValue?: number | null;
}

/** The fixed set of expense categories, with display labels and emoji glyphs. */
export const EXPENSE_CATEGORIES = [
  { key: 'food', label: 'Food & Drink', emoji: '🍽️' },
  { key: 'groceries', label: 'Groceries', emoji: '🛒' },
  { key: 'lodging', label: 'Lodging', emoji: '🏨' },
  { key: 'transport', label: 'Transport', emoji: '🚗' },
  { key: 'entertainment', label: 'Entertainment', emoji: '🎉' },
  { key: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { key: 'utilities', label: 'Utilities', emoji: '💡' },
  { key: 'other', label: 'Other', emoji: '🧾' },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['key'];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as ExpenseCategory[];
export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'other';

const OTHER_CATEGORY_META = EXPENSE_CATEGORIES.find((c) => c.key === DEFAULT_EXPENSE_CATEGORY)!;

/** Look up a category's label + emoji, falling back to Other for unknown/legacy values. */
export function categoryMeta(key: string | null | undefined): (typeof EXPENSE_CATEGORIES)[number] {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? OTHER_CATEGORY_META;
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: ExpenseSplitMethod;
  /** What kind of spend this was. Legacy rows may be null; treat as "other". */
  category: ExpenseCategory | null;
  createdAt: string;
  /** The effective expense date (user-set date, else createdAt). Drives feed order + display. */
  date: string;
  splits: ExpenseSplit[];
  /** Present only for ITEMIZED expenses, so the edit form can prefill the receipt. */
  taxCents?: number;
  tipCents?: number;
  items?: ExpenseItemInput[];
  /** The most recent correction, when somebody has changed this. Absent means nobody has. */
  lastEdit?: {
    at: string;
    byId: string;
    /** Which of amount / description / payer / split moved. */
    fields: string[];
    formerAmountCents: number;
  };
}

export interface SplitParticipantValue {
  userId: string;
  value?: number;
}

export interface CreateExpensePayload {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  participants: SplitParticipantValue[];
  /** Spend category. Omit to default to "other". */
  category?: ExpenseCategory;
  /** The date the expense happened, as YYYY-MM-DD. Omit for "today". */
  date?: string;
}

export interface ExpenseItemInput {
  name: string;
  amountCents: number;
  participantIds: string[];
  /** Who paid for this item. Omit to fall back to the expense's payer. */
  payerId?: string;
}

export interface CreateItemizedPayload {
  description: string;
  payerId: string;
  taxCents: number;
  tipCents: number;
  items: ExpenseItemInput[];
  /** Spend category. Omit to default to "other". */
  category?: ExpenseCategory;
  /** The date the expense happened, as YYYY-MM-DD. Omit for "today". */
  date?: string;
}

/** Receipt OCR result: line items plus tax and tip, all in integer cents. */
export interface ExtractedReceipt {
  items: { name: string; amountCents: number }[];
  taxCents: number;
  tipCents: number;
}

// --- Settlements ------------------------------------------------------------

export interface Settlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  method: PaymentMethod | null;
  createdAt: string;
}

export interface RecordSettlementPayload {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  method?: PaymentMethod;
}

export interface SuggestedPayment {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

/** Read-only group view served on the public share page (no payment handles, no line items). */
export interface SharedGroupSummary {
  groupId: string;
  groupName: string;
  currency: string;
  memberCount: number;
  totalSpentCents: number;
  perPersonCents: number;
  totalSettledCents: number;
  // isPlaceholder members are unclaimed seats a signed-in visitor can claim as their own.
  members: { userId: string; displayName: string; netCents: number; isPlaceholder: boolean }[];
  suggested: { fromName: string; toName: string; amountCents: number }[];
  breakdown: { category: string; cents: number }[];
}
