import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { GroupRole, PrismaClient } from '@prisma/client';
import { emitGroupChanged } from '../../realtime/bus.js';

export type GroupErrorCode =
  | 'NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'NOT_OWNER'
  | 'CANNOT_REMOVE_OWNER'
  | 'HAS_ACTIVITY';

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

/** Like requireMembership, but also requires the OWNER role. */
async function requireOwner(prisma: PrismaClient, userId: string, groupId: string): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) {
    throw new GroupError('NOT_FOUND', 'Group not found.');
  }
  if (membership.role !== 'OWNER') {
    throw new GroupError('NOT_OWNER', 'Only the group owner can do that.');
  }
}

export async function renameGroup(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  name: string,
): Promise<GroupDetail> {
  await requireOwner(prisma, userId, groupId);
  await prisma.group.update({ where: { id: groupId }, data: { name } });
  emitGroupChanged(groupId);
  return getGroup(prisma, userId, groupId);
}

export async function deleteGroup(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<void> {
  await requireOwner(prisma, userId, groupId);
  // Cascades members, expenses, splits, settlements, and invites.
  await prisma.group.delete({ where: { id: groupId } });
  // Placeholder users left with no memberships are now junk.
  await prisma.user.deleteMany({ where: { isPlaceholder: true, memberships: { none: {} } } });
}

/**
 * Remove a member (or leave). Owners can remove others; anyone can leave. The owner
 * can't be removed (delete the group instead), and nobody with ledger activity can be
 * removed (it would orphan their splits and break balances) until those are cleared.
 */
export async function removeMember(
  prisma: PrismaClient,
  actingUserId: string,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  await requireMembership(prisma, actingUserId, groupId);

  const target = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: targetUserId } },
  });
  if (!target) {
    throw new GroupError('NOT_FOUND', 'They are not in this group.');
  }
  if (target.role === 'OWNER') {
    throw new GroupError('CANNOT_REMOVE_OWNER', 'The owner cannot be removed; delete the group instead.');
  }
  if (targetUserId !== actingUserId) {
    const acting = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: actingUserId } },
    });
    if (acting?.role !== 'OWNER') {
      throw new GroupError('NOT_OWNER', 'Only the owner can remove other people.');
    }
  }

  const [asPayer, asSplit, asItemShare, asSettlement] = await Promise.all([
    prisma.expense.count({ where: { groupId, payerId: targetUserId } }),
    prisma.expenseSplit.count({ where: { userId: targetUserId, expense: { groupId } } }),
    prisma.expenseItemShare.count({ where: { userId: targetUserId, item: { expense: { groupId } } } }),
    prisma.settlement.count({
      where: { groupId, OR: [{ fromUserId: targetUserId }, { toUserId: targetUserId }] },
    }),
  ]);
  if (asPayer || asSplit || asItemShare || asSettlement) {
    throw new GroupError('HAS_ACTIVITY', "They're already in expenses here. Settle and clear those first.");
  }

  await prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  // Clean up a placeholder that this removal just orphaned.
  await prisma.user.deleteMany({
    where: { id: targetUserId, isPlaceholder: true, memberships: { none: {} } },
  });
  emitGroupChanged(groupId);
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
