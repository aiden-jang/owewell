import { Prisma } from '@prisma/client';
import type { PrismaClient, User } from '@prisma/client';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createSession } from '../../lib/session.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

export type AuthErrorCode = 'EMAIL_TAKEN' | 'INVALID_CREDENTIALS';

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
