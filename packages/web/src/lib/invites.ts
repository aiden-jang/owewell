import { api } from './api';

export interface InviteInfo {
  groupName: string;
  email: string | null;
  status: 'pending' | 'accepted' | 'expired';
}

export const invitesApi = {
  create: (groupId: string, email?: string): Promise<{ token: string }> =>
    api
      .post<{ invite: { token: string } }>(`/groups/${groupId}/invites`, email ? { email } : {})
      .then((r) => r.invite),
  info: (token: string): Promise<InviteInfo> =>
    api.get<{ invite: InviteInfo }>(`/invites/${token}`).then((r) => r.invite),
  accept: (token: string): Promise<string> =>
    api.post<{ groupId: string }>(`/invites/${token}/accept`).then((r) => r.groupId),
};
