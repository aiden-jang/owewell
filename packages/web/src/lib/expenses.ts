import type { CreateExpensePayload, CreateItemizedPayload, Expense } from '@owewell/core';
import { api } from './api';

function deletionPath(
  groupId: string,
  expenseId: string,
  restore: boolean,
  clientId?: string,
  version?: number,
) {
  const query = new URLSearchParams();
  if (clientId) query.set('clientId', clientId);
  if (version !== undefined) query.set('expectedVersion', String(version));
  return `/groups/${groupId}/expenses/${expenseId}${restore ? '/restore' : ''}${query.size ? `?${query}` : ''}`;
}

// Re-export the shared contract so components can keep importing expense types from here.
export type { CreateExpensePayload, CreateItemizedPayload, Expense, SplitMethod } from '@owewell/core';

export const expensesApi = {
  list: (groupId: string, actorId?: string): Promise<Expense[]> =>
    api.get<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`, actorId).then((r) => r.expenses),
  create: (groupId: string, payload: CreateExpensePayload, actorId?: string): Promise<Expense> =>
    api.post<{ expense: Expense }>(`/groups/${groupId}/expenses`, payload, actorId).then((r) => r.expense),
  update: (
    groupId: string,
    expenseId: string,
    payload: CreateExpensePayload,
    actorId?: string,
  ): Promise<Expense> =>
    api
      .put<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`, payload, actorId)
      .then((r) => r.expense),
  createItemized: (groupId: string, payload: CreateItemizedPayload, actorId?: string): Promise<Expense> =>
    api
      .post<{ expense: Expense }>(`/groups/${groupId}/expenses/itemized`, payload, actorId)
      .then((r) => r.expense),
  updateItemized: (
    groupId: string,
    expenseId: string,
    payload: CreateItemizedPayload,
    actorId?: string,
  ): Promise<Expense> =>
    api
      .put<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}/itemized`, payload, actorId)
      .then((r) => r.expense),
  remove: (
    groupId: string,
    expenseId: string,
    actorId?: string,
    clientId?: string,
    version?: number,
  ): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(deletionPath(groupId, expenseId, false, clientId, version), actorId),
  /** Undo a delete. Returns the restored expense so the feed can put the row back immediately. */
  restore: (groupId: string, expenseId: string, clientId: string, actorId?: string): Promise<Expense> =>
    api
      .post<{ expense: Expense }>(deletionPath(groupId, expenseId, true, clientId), {}, actorId)
      .then((r) => r.expense),
};
