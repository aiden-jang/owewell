import { api, API_BASE } from './api';

export interface OcrResult {
  items: { name: string; amountCents: number }[];
  taxCents: number;
  tipCents: number;
}

/** Upload a receipt image and get back extracted line items + tax/tip. */
export async function ocrReceipt(groupId: string, file: File): Promise<OcrResult> {
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
  return (await res.json()).receipt as OcrResult;
}

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
