import { api } from './api';

export interface SuggestedPayment {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

export interface Settlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  createdAt: string;
}

export const settlementsApi = {
  suggested: (groupId: string): Promise<SuggestedPayment[]> =>
    api
      .get<{ payments: SuggestedPayment[] }>(`/groups/${groupId}/suggested-payments`)
      .then((r) => r.payments),
  list: (groupId: string): Promise<Settlement[]> =>
    api.get<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`).then((r) => r.settlements),
  record: (
    groupId: string,
    body: { fromUserId: string; toUserId: string; amountCents: number },
  ): Promise<Settlement> =>
    api.post<{ settlement: Settlement }>(`/groups/${groupId}/settlements`, body).then((r) => r.settlement),
};
