import { api } from './api';

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  /** The current user's net in this group. Positive: they're owed. Negative: they owe. */
  netCents: number;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  createdById: string;
  createdAt: string;
  members: GroupMember[];
}

export interface Balance {
  userId: string;
  displayName: string;
  netCents: number;
}

export const groupsApi = {
  list: (): Promise<GroupSummary[]> =>
    api.get<{ groups: GroupSummary[] }>('/groups').then((r) => r.groups),
  create: (name: string): Promise<GroupDetail> =>
    api.post<{ group: GroupDetail }>('/groups', { name }).then((r) => r.group),
  get: (id: string): Promise<GroupDetail> =>
    api.get<{ group: GroupDetail }>(`/groups/${id}`).then((r) => r.group),
  addMember: (id: string, email: string): Promise<GroupMember> =>
    api.post<{ member: GroupMember }>(`/groups/${id}/members`, { email }).then((r) => r.member),
  balances: (id: string): Promise<Balance[]> =>
    api.get<{ balances: Balance[] }>(`/groups/${id}/balances`).then((r) => r.balances),
  rename: (id: string, name: string): Promise<GroupDetail> =>
    api.patch<{ group: GroupDetail }>(`/groups/${id}`, { name }).then((r) => r.group),
  remove: (id: string): Promise<void> => api.del(`/groups/${id}`).then(() => undefined),
  removeMember: (id: string, userId: string): Promise<void> =>
    api.del(`/groups/${id}/members/${userId}`).then(() => undefined),
};
