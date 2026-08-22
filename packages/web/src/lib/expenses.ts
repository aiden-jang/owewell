import type {
  CreateExpensePayload,
  CreateItemizedPayload,
  Expense,
  ExtractedReceipt,
} from '@owewell/core';
import { api, API_BASE } from './api';

// Re-export the shared contract so components can keep importing expense types from here.
export type {
  CreateExpensePayload,
  CreateItemizedPayload,
  Expense,
  ExpenseSplit,
  ExpenseSplitMethod,
  ExtractedReceipt,
  SplitMethod,
} from '@owewell/core';

/** Upload a receipt image and get back extracted line items + tax/tip. */
export async function ocrReceipt(groupId: string, file: File): Promise<ExtractedReceipt> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/groups/${groupId}/ocr`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    throw new Error('Could not read that receipt.');
  }
  return (await res.json()).receipt as ExtractedReceipt;
}

export const expensesApi = {
  list: (groupId: string): Promise<Expense[]> =>
    api.get<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`).then((r) => r.expenses),
  create: (groupId: string, payload: CreateExpensePayload): Promise<Expense> =>
    api.post<{ expense: Expense }>(`/groups/${groupId}/expenses`, payload).then((r) => r.expense),
  update: (groupId: string, expenseId: string, payload: CreateExpensePayload): Promise<Expense> =>
    api.put<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`, payload).then((r) => r.expense),
  createItemized: (groupId: string, payload: CreateItemizedPayload): Promise<Expense> =>
    api
      .post<{ expense: Expense }>(`/groups/${groupId}/expenses/itemized`, payload)
      .then((r) => r.expense),
  updateItemized: (groupId: string, expenseId: string, payload: CreateItemizedPayload): Promise<Expense> =>
    api
      .put<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}/itemized`, payload)
      .then((r) => r.expense),
  remove: (groupId: string, expenseId: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/groups/${groupId}/expenses/${expenseId}`),
  /** Undo a delete. Returns the restored expense so the feed can put the row back immediately. */
  restore: (groupId: string, expenseId: string): Promise<Expense> =>
    api
      .post<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}/restore`, {})
      .then((r) => r.expense),
};
