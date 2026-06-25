import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient, User } from '@prisma/client';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createSession } from '../../lib/session.js';
import type { EmailTransport } from '../../lib/email.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

export type AuthErrorCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'WRONG_PASSWORD'
  | 'INVALID_TOKEN';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** The user shape safe to send to clients (never the password hash). */
export type PublicUser = Pick<User, 'id' | 'email' | 'displayName' | 'createdAt'>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

// Hashed once, lazily: verifying against it on the no-such-user path keeps login
// timing roughly constant so attackers cannot enumerate registered emails.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('owe-well-timing-equalizer');
  return dummyHashPromise;
}

export async function registerUser(prisma: PrismaClient, input: RegisterBody): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: { email: input.email, displayName: input.displayName, passwordHash },
    });
    const { token, expiresAt } = await createSession(prisma, user.id);
    return { user: toPublicUser(user), token, expiresAt };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AuthError('EMAIL_TAKEN', 'That email is already registered.');
    }
    throw err;
  }
}

export async function loginUser(prisma: PrismaClient, input: LoginBody): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  const { token, expiresAt } = await createSession(prisma, user.id);
  return { user: toPublicUser(user), token, expiresAt };
}

export async function updateProfile(
  prisma: PrismaClient,
  userId: string,
  displayName: string,
): Promise<PublicUser> {
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName } });
  return toPublicUser(user);
}

export async function changePassword(
  prisma: PrismaClient,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw new AuthError('WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a reset link by email. Always succeeds (no-op for unknown/placeholder
 * accounts) so it can't be used to probe which emails are registered.
 */
export async function requestPasswordReset(
  prisma: PrismaClient,
  email: string,
  appUrl: string,
  transport: EmailTransport,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.isPlaceholder) return;

  const token = randomBytes(32).toString('base64url');
  await prisma.passwordResetToken.create({
    data: {
      id: hashResetToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const link = `${appUrl}/reset-password?token=${token}`;
  await transport.send({
    to: user.email,
    subject: 'Reset your Owe Well password',
    text: `Reset your password here: ${link}\n\nThe link expires in an hour. If you didn't ask for this, ignore it.`,
  });
}

export async function resetPassword(
  prisma: PrismaClient,
  token: string,
  newPassword: string,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { id: hashResetToken(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new AuthError('INVALID_TOKEN', 'This reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Sign out everywhere; whoever reset now holds the only valid path back in.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
}
