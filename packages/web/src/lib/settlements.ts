import type { RecordSettlementPayload, Settlement } from '@owewell/core';
import { api } from './api';
import { enqueue, isSettlement, needsPaymentReview, queued } from './outbox';

// Re-export the shared contract so components can keep importing settlement types from here.
export type { RecordSettlementPayload, Settlement, SuggestedPayment } from '@owewell/core';

const paymentAttempts = new Map<string, string>();

function paymentKey(
  groupId: string,
  body: Omit<RecordSettlementPayload, 'clientId'>,
  ownerId?: string,
): string {
  return `owewell:payment-attempt:${JSON.stringify([
    groupId,
    ownerId ?? null,
    body.fromUserId,
    body.toUserId,
    body.amountCents,
    ...(body.suggestedVersion === undefined ? [] : [body.suggestedVersion]),
  ])}`;
}

function savedAttempt(key: string): string | null {
  try {
    return paymentAttempts.get(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function hasQueuedPayment(
  groupId: string,
  body: Omit<RecordSettlementPayload, 'clientId'>,
  ownerId?: string,
) {
  return queued(groupId, ownerId)
    .filter(isSettlement)
    .filter((entry) => !needsPaymentReview(entry))
    .some(
      ({ payload }) =>
        payload.fromUserId === body.fromUserId &&
        payload.toUserId === body.toUserId &&
        payload.amountCents === body.amountCents,
    );
}

export function preparePayment(
  groupId: string,
  body: Omit<RecordSettlementPayload, 'clientId'>,
  ownerId?: string,
) {
  const key = paymentKey(groupId, body, ownerId);
  const clientId = savedAttempt(key) ?? crypto.randomUUID();
  paymentAttempts.set(key, clientId);
  try {
    sessionStorage.setItem(key, clientId);
  } catch {
    // In-memory identity still covers retries in this page when storage is blocked.
  }
  return {
    ...body,
    clientId,
    ...(body.suggestedVersion === undefined ? { confirmedManual: true as const } : {}),
  };
}

export function queuePayment(
  groupId: string,
  payload: RecordSettlementPayload & { clientId: string },
  description: string,
  ownerId?: string,
): boolean {
  return enqueue({
    clientId: payload.clientId,
    groupId,
    ownerId,
    kind: 'settlement',
    ...(payload.suggestedVersion === undefined ? { manual: true } : {}),
    description,
    amountCents: payload.amountCents,
    queuedAt: Date.now(),
    payload,
  });
}

function completePaymentAttempt(groupId: string, body: RecordSettlementPayload, ownerId?: string): void {
  const key = paymentKey(groupId, body, ownerId);
  if (!body.clientId || savedAttempt(key) !== body.clientId) return;
  paymentAttempts.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable after the request.
  }
}

export const settlementsApi = {
  list: (groupId: string, actorId?: string): Promise<Settlement[]> =>
    api
      .get<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`, actorId)
      .then((r) => r.settlements),
  record: async (groupId: string, body: RecordSettlementPayload, actorId?: string): Promise<Settlement> => {
    const { settlement } = await api.post<{ settlement: Settlement }>(
      `/groups/${groupId}/settlements`,
      body,
      actorId,
    );
    completePaymentAttempt(groupId, body, actorId);
    return settlement;
  },
  remove: (groupId: string, settlementId: string, actorId?: string): Promise<void> =>
    api.del(`/groups/${groupId}/settlements/${settlementId}`, actorId).then(() => undefined),
};
