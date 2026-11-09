import type { Balance, GroupDetail, GroupMember, GroupSummary, SharedGroupSummary } from '@owewell/core';
import { api } from './api';

// Re-export the shared contract so components can keep importing group types from here.
export type { Balance, GroupDetail, GroupMember, GroupSummary, SharedGroupSummary } from '@owewell/core';

export const groupsApi = {
  list: (actorId?: string): Promise<GroupSummary[]> =>
    api.get<{ groups: GroupSummary[] }>('/groups', actorId).then((r) => r.groups),
  create: (name: string, clientId: string, ownerId?: string): Promise<GroupDetail> =>
    api.post<{ group: GroupDetail }>('/groups', { name, clientId }, ownerId).then((r) => r.group),
  get: (id: string, actorId?: string): Promise<GroupDetail> =>
    api.get<{ group: GroupDetail }>(`/groups/${id}`, actorId).then((r) => r.group),
  // Add a name-only placeholder (someone not on owewell yet). Real accounts join via an
  // invite link instead, since owewell can't look up other people's accounts by email.
  addPlaceholder: (id: string, name: string, actorId?: string, clientId?: string): Promise<GroupMember> =>
    api
      .post<{ member: GroupMember }>(`/groups/${id}/members`, { name, clientId }, actorId)
      .then((r) => r.member),
  // Rename a name-only placeholder member. Real accounts own their name via the auth service.
  renameMember: (id: string, userId: string, name: string, actorId?: string): Promise<GroupMember> =>
    api
      .patch<{ member: GroupMember }>(`/groups/${id}/members/${userId}`, { name }, actorId)
      .then((r) => r.member),
  // Set a member's payment handles (for settle-up deep links). Omitted fields are left as-is;
  // an empty string clears one. Editable for yourself or a name-only placeholder.
  setPaymentHandles: (
    id: string,
    userId: string,
    handles: { venmoHandle?: string; cashappCashtag?: string; paypalHandle?: string },
    actorId?: string,
  ): Promise<GroupMember> =>
    api
      .patch<{ member: GroupMember }>(`/groups/${id}/members/${userId}/payment`, handles, actorId)
      .then((r) => r.member),
  balances: (id: string, actorId?: string): Promise<{ balances: Balance[]; ledgerVersion?: number }> =>
    api.get(`/groups/${id}/balances`, actorId),
  rename: (id: string, name: string, actorId?: string): Promise<GroupDetail> =>
    api.patch<{ group: GroupDetail }>(`/groups/${id}`, { name }, actorId).then((r) => r.group),
  setArchived: (id: string, archived: boolean, actorId?: string): Promise<GroupDetail> =>
    api.post<{ group: GroupDetail }>(`/groups/${id}/archive`, { archived }, actorId).then((r) => r.group),
  remove: (id: string, actorId?: string): Promise<void> =>
    api.del(`/groups/${id}`, actorId).then(() => undefined),
  removeMember: (id: string, userId: string, actorId?: string): Promise<void> =>
    api.del(`/groups/${id}/members/${userId}`, actorId).then(() => undefined),
  // Create (or fetch) the group's public read-only share token. Members only.
  createShareLink: (id: string, actorId?: string): Promise<string> =>
    api.post<{ token: string }>(`/groups/${id}/share`, {}, actorId).then((r) => r.token),
  // Owner-only. Mints a replacement so every copy of the old link stops resolving.
  rotateShare: (id: string, actorId?: string): Promise<string> =>
    api.post<{ token: string }>(`/groups/${id}/share/rotate`, {}, actorId).then((r) => r.token),
  // Owner-only. Removes the public view; sharing again mints a fresh token.
  revokeShare: (id: string, actorId?: string): Promise<void> =>
    api.del(`/groups/${id}/share`, actorId).then(() => undefined),
  // Public: fetch a group's read-only summary by share token (works signed-out).
  sharedSummary: (token: string): Promise<SharedGroupSummary> =>
    api.get<{ summary: SharedGroupSummary }>(`/shared/${token}`).then((r) => r.summary),
  // Claim an unclaimed placeholder seat via a share token. Requires sign-in.
  claimSeat: (token: string, personId: string, actorId?: string): Promise<{ groupId: string }> =>
    api.post<{ groupId: string }>(`/shared/${token}/claim`, { personId }, actorId),
};
