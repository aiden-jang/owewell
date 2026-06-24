import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { requireMembership } from '../groups/groups.service.js';
import { emitGroupChanged } from '../../realtime/bus.js';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type InviteErrorCode = 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_ACCEPTED';

export class InviteError extends Error {
  constructor(
    readonly code: InviteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

export interface InviteView {
  token: string;
  email: string | null;
  expiresAt: Date;
}

export interface InviteInfo {
  groupName: string;
  email: string | null;
  status: 'pending' | 'accepted' | 'expired';
}

export async function createInvite(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  email?: string,
): Promise<InviteView> {
  await requireMembership(prisma, userId, groupId);
  const token = randomBytes(24).toString('base64url');
  const invite = await prisma.invite.create({
    data: {
      groupId,
      token,
      email: email ?? null,
      invitedById: userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  return { token: invite.token, email: invite.email, expiresAt: invite.expiresAt };
}

/** Public lookup so the invite landing page can show the group before sign-in. */
export async function getInviteInfo(prisma: PrismaClient, token: string): Promise<InviteInfo> {
  const invite = await prisma.invite.findUnique({ where: { token }, include: { group: true } });
  if (!invite) {
    throw new InviteError('NOT_FOUND', 'This invite link is not valid.');
  }
  const status = invite.acceptedAt
    ? 'accepted'
    : invite.expiresAt.getTime() <= Date.now()
      ? 'expired'
      : 'pending';
  return { groupName: invite.group.name, email: invite.email, status };
}

export async function acceptInvite(
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<{ groupId: string }> {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    throw new InviteError('NOT_FOUND', 'This invite link is not valid.');
  }
  if (invite.acceptedAt) {
    throw new InviteError('ALREADY_ACCEPTED', 'This invite has already been used.');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new InviteError('EXPIRED', 'This invite has expired.');
  }

  // Idempotent join: if they were already a member, just consume the invite.
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: invite.groupId, userId } },
    create: { groupId: invite.groupId, userId, role: 'MEMBER' },
    update: {},
  });
  await prisma.invite.update({ where: { token }, data: { acceptedAt: new Date() } });

  emitGroupChanged(invite.groupId);
  return { groupId: invite.groupId };
}
