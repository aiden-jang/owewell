import { api } from './api';

export type SplitMethod = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';

export interface ExpenseSplit {
  userId: string;
  owedCents: number;
}

export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  createdAt: string;
  splits: ExpenseSplit[];
}

export interface CreateExpensePayload {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  participants: { userId: string; value?: number }[];
}

export interface CreateItemizedPayload {
  description: string;
  payerId: string;
  taxCents: number;
  tipCents: number;
  items: { name: string; amountCents: number; participantIds: string[] }[];
}

export const expensesApi = {
  list: (groupId: string): Promise<Expense[]> =>
    api.get<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`).then((r) => r.expenses),
  create: (groupId: string, payload: CreateExpensePayload): Promise<Expense> =>
    api.post<{ expense: Expense }>(`/groups/${groupId}/expenses`, payload).then((r) => r.expense),
  createItemized: (groupId: string, payload: CreateItemizedPayload): Promise<Expense> =>
    api
      .post<{ expense: Expense }>(`/groups/${groupId}/expenses/itemized`, payload)
      .then((r) => r.expense),
};
