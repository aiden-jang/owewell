import type { RecordSettlementPayload, Settlement, SuggestedPayment } from '@owewell/core';
import { api } from './api';

// Re-export the shared contract so components can keep importing settlement types from here.
export type { RecordSettlementPayload, Settlement, SuggestedPayment } from '@owewell/core';

export const settlementsApi = {
  suggested: (groupId: string): Promise<SuggestedPayment[]> =>
    api
      .get<{ suggested: SuggestedPayment[] }>(`/groups/${groupId}/settlements/suggested`)
      .then((r) => r.suggested),
  list: (groupId: string): Promise<Settlement[]> =>
    api.get<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`).then((r) => r.settlements),
  record: (groupId: string, body: RecordSettlementPayload): Promise<Settlement> =>
    api.post<{ settlement: Settlement }>(`/groups/${groupId}/settlements`, body).then((r) => r.settlement),
  remove: (groupId: string, settlementId: string): Promise<void> =>
    api.del(`/groups/${groupId}/settlements/${settlementId}`).then(() => undefined),
};
