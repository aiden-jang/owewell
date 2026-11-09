import { EXPENSE_CATEGORY_KEYS, type ExpenseCategory } from '@owewell/core';
import { SPLIT_METHODS, type SplitMethod } from '@owewell/shared';

export interface ExpenseDraftFields {
  description: string;
  payerId: string;
  date: string;
  category: ExpenseCategory;
  note: string;
}

export interface ExpenseAttempt {
  key: string;
  id: string;
}

export type ExpenseDraftInput =
  | {
      mode: 'simple';
      amount: string;
      method: SplitMethod;
      selected: string[];
      values: Record<string, string>;
    }
  | {
      mode: 'itemized';
      tax: string;
      tip: string;
      items: { name: string; amount: string; participantIds: string[]; payerId: string }[];
    };

export interface ExpenseEditorDraft {
  fields: ExpenseDraftFields;
  input: ExpenseDraftInput;
  baseVersion?: number | undefined;
  attempt?: ExpenseAttempt | null;
}

export function expenseEditorKey(ownerId: string | undefined, groupId: string, editor = 'add') {
  return ownerId ? `owewell:expense-draft:v1:${JSON.stringify([ownerId, groupId, editor])}` : undefined;
}

function hasStrings(value: object, keys: readonly string[]) {
  return keys.every((key) => typeof Reflect.get(value, key) === 'string');
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

export function readExpenseEditorDraft(key?: string): ExpenseEditorDraft | null {
  try {
    const draft = key && JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!draft || typeof draft.fields !== 'object' || !draft.fields) return null;
    if (!hasStrings(draft.fields, ['description', 'payerId', 'date', 'note'])) return null;
    if (!EXPENSE_CATEGORY_KEYS.includes(draft.fields.category)) return null;
    const input = draft.input;
    if (input?.mode === 'simple') {
      if (
        typeof input.amount !== 'string' ||
        !SPLIT_METHODS.includes(input.method) ||
        !stringList(input.selected) ||
        !input.values ||
        typeof input.values !== 'object' ||
        !Object.values(input.values).every((value) => typeof value === 'string')
      )
        return null;
    } else if (
      input?.mode !== 'itemized' ||
      !hasStrings(input, ['tax', 'tip']) ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      !input.items.every(
        (item: unknown) =>
          item !== null &&
          typeof item === 'object' &&
          hasStrings(item, ['name', 'amount', 'payerId']) &&
          'participantIds' in item &&
          stringList(item.participantIds),
      )
    )
      return null;
    if (draft.attempt && !hasStrings(draft.attempt, ['key', 'id'])) return null;
    if (draft.baseVersion !== undefined && !Number.isSafeInteger(draft.baseVersion)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function discardExpenseEditorDraft(key?: string, expected?: string) {
  try {
    if (key && (expected === undefined || sessionStorage.getItem(key) === expected))
      sessionStorage.removeItem(key);
  } catch {
    // Editing still works in browsers that block storage.
  }
}
