import type { Balance, GroupDetail, GroupMember, GroupSummary, SharedGroupSummary } from '@owewell/core';
import { api } from './api';

// Re-export the shared contract so components can keep importing group types from here.
export type { Balance, GroupDetail, GroupMember, GroupRole, GroupSummary, SharedGroupSummary } from '@owewell/core';

export const groupsApi = {
  list: (): Promise<GroupSummary[]> =>
    api.get<{ groups: GroupSummary[] }>('/groups').then((r) => r.groups),
  create: (name: string): Promise<GroupDetail> =>
    api.post<{ group: GroupDetail }>('/groups', { name }).then((r) => r.group),
  get: (id: string): Promise<GroupDetail> =>
    api.get<{ group: GroupDetail }>(`/groups/${id}`).then((r) => r.group),
  // Add a name-only placeholder (someone not on owewell yet). Real accounts join via an
  // invite link instead, since owewell can't look up other people's accounts by email.
  addPlaceholder: (id: string, name: string): Promise<GroupMember> =>
    api.post<{ member: GroupMember }>(`/groups/${id}/members`, { name }).then((r) => r.member),
  // Rename a name-only placeholder member. Real accounts own their name via the auth service.
  renameMember: (id: string, userId: string, name: string): Promise<GroupMember> =>
    api.patch<{ member: GroupMember }>(`/groups/${id}/members/${userId}`, { name }).then((r) => r.member),
  // Set a member's payment handles (for settle-up deep links). Omitted fields are left as-is;
  // an empty string clears one. Editable for yourself or a name-only placeholder.
  setPaymentHandles: (
    id: string,
    userId: string,
    handles: { venmoHandle?: string; cashappCashtag?: string; paypalHandle?: string },
  ): Promise<GroupMember> =>
    api
      .patch<{ member: GroupMember }>(`/groups/${id}/members/${userId}/payment`, handles)
      .then((r) => r.member),
  balances: (id: string): Promise<Balance[]> =>
    api.get<{ balances: Balance[] }>(`/groups/${id}/balances`).then((r) => r.balances),
  rename: (id: string, name: string): Promise<GroupDetail> =>
    api.patch<{ group: GroupDetail }>(`/groups/${id}`, { name }).then((r) => r.group),
  setSettlementDeadline: (id: string, settleBy: string | null): Promise<GroupDetail> =>
    api.patch<{ group: GroupDetail }>(`/groups/${id}/settle-by`, { settleBy }).then((r) => r.group),
  setArchived: (id: string, archived: boolean): Promise<GroupDetail> =>
    api.post<{ group: GroupDetail }>(`/groups/${id}/archive`, { archived }).then((r) => r.group),
  remove: (id: string): Promise<void> => api.del(`/groups/${id}`).then(() => undefined),
  removeMember: (id: string, userId: string): Promise<void> =>
    api.del(`/groups/${id}/members/${userId}`).then(() => undefined),
  // Create (or fetch) the group's public read-only share token. Members only.
  createShareLink: (id: string): Promise<string> =>
    api.post<{ token: string }>(`/groups/${id}/share`, {}).then((r) => r.token),
  // Public: fetch a group's read-only summary by share token (works signed-out).
  sharedSummary: (token: string): Promise<SharedGroupSummary> =>
    api.get<{ summary: SharedGroupSummary }>(`/shared/${token}`).then((r) => r.summary),
  // Claim an unclaimed placeholder seat via a share token. Requires sign-in.
  claimSeat: (token: string, personId: string): Promise<{ groupId: string }> =>
    api.post<{ groupId: string }>(`/shared/${token}/claim`, { personId }),
};
