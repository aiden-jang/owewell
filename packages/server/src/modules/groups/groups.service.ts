import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { GroupRole, PrismaClient } from '@prisma/client';
import { emitGroupChanged } from '../../realtime/bus.js';

export type GroupErrorCode = 'NOT_FOUND' | 'USER_NOT_FOUND' | 'ALREADY_MEMBER';

export class GroupError extends Error {
  constructor(
    readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GroupError';
  }
}

export interface GroupMemberView {
  userId: string;
  displayName: string;
  email: string | null;
  role: GroupRole;
  joinedAt: Date;
  isPlaceholder: boolean;
}

export interface GroupDetail {
  id: string;
  name: string;
  createdById: string;
  createdAt: Date;
  members: GroupMemberView[];
}

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: Date;
  memberCount: number;
}

interface MemberWithUser {
  userId: string;
  role: GroupRole;
  joinedAt: Date;
  user: { displayName: string; email: string; isPlaceholder: boolean };
}

function toMemberView(member: MemberWithUser): GroupMemberView {
  return {
    userId: member.userId,
    displayName: member.user.displayName,
    email: member.user.isPlaceholder ? null : member.user.email,
    role: member.role,
    joinedAt: member.joinedAt,
    isPlaceholder: member.user.isPlaceholder,
  };
}

function toGroupDetail(group: {
  id: string;
  name: string;
  createdById: string;
  createdAt: Date;
  members: MemberWithUser[];
}): GroupDetail {
  return {
    id: group.id,
    name: group.name,
    createdById: group.createdById,
    createdAt: group.createdAt,
    members: group.members.map(toMemberView),
  };
}

/** Throws NOT_FOUND if the user is not a member, which doubles as "does not exist" to outsiders. */
export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    throw new GroupError('NOT_FOUND', 'Group not found.');
  }
}

export async function createGroup(
  prisma: PrismaClient,
  userId: string,
  name: string,
): Promise<GroupDetail> {
  const group = await prisma.group.create({
    data: {
      name,
      createdById: userId,
      members: { create: { userId, role: 'OWNER' } },
    },
    include: { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
  });
  return toGroupDetail(group);
}

export async function listGroups(prisma: PrismaClient, userId: string): Promise<GroupSummary[]> {
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId } } },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    memberCount: group._count.members,
  }));
}

export async function getGroup(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<GroupDetail> {
  await requireMembership(prisma, userId, groupId);
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
  });
  return toGroupDetail(group);
}

export async function addMember(
  prisma: PrismaClient,
  actingUserId: string,
  groupId: string,
  email: string,
): Promise<GroupMemberView> {
  await requireMembership(prisma, actingUserId, groupId);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new GroupError('USER_NOT_FOUND', 'No Owe Well account with that email.');
  }

  try {
    const member = await prisma.groupMember.create({
      data: { groupId, userId: user.id, role: 'MEMBER' },
      include: { user: true },
    });
    emitGroupChanged(groupId);
    return toMemberView(member);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new GroupError('ALREADY_MEMBER', 'They are already in this group.');
    }
    throw err;
  }
}

/** Add a name-only person (no account) to the group. Backed by a placeholder user. */
export async function addPlaceholderMember(
  prisma: PrismaClient,
  actingUserId: string,
  groupId: string,
  name: string,
): Promise<GroupMemberView> {
  await requireMembership(prisma, actingUserId, groupId);
  const member = await prisma.groupMember.create({
    data: {
      group: { connect: { id: groupId } },
      role: 'MEMBER',
      user: {
        create: {
          email: `placeholder.${randomUUID()}@owe-well.local`,
          displayName: name,
          passwordHash: '!', // not a valid argon2 hash; login can never succeed
          isPlaceholder: true,
        },
      },
    },
    include: { user: true },
  });
  emitGroupChanged(groupId);
  return toMemberView(member);
}
