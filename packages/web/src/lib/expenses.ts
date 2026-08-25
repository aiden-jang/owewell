import type { CreateExpensePayload, CreateItemizedPayload, Expense } from '@owewell/core';
import { api } from './api';

// Re-export the shared contract so components can keep importing expense types from here.
export type {
  CreateExpensePayload,
  CreateItemizedPayload,
  Expense,
  ExpenseSplit,
  ExpenseSplitMethod,
  SplitMethod,
} from '@owewell/core';

export const expensesApi = {
  list: (groupId: string): Promise<Expense[]> =>
    api.get<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`).then((r) => r.expenses),
  create: (groupId: string, payload: CreateExpensePayload): Promise<Expense> =>
    api.post<{ expense: Expense }>(`/groups/${groupId}/expenses`, payload).then((r) => r.expense),
  update: (groupId: string, expenseId: string, payload: CreateExpensePayload): Promise<Expense> =>
    api.put<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`, payload).then((r) => r.expense),
  createItemized: (groupId: string, payload: CreateItemizedPayload): Promise<Expense> =>
    api.post<{ expense: Expense }>(`/groups/${groupId}/expenses/itemized`, payload).then((r) => r.expense),
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
