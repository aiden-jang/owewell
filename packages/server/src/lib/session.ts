import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { PrismaClient, User } from '@prisma/client';

export const SESSION_COOKIE = 'owe_well_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Cookie options shared by set and clear so they always match. */
export function baseCookieOptions(): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    // 'lax' is safe across subdomains of one registrable domain (same site), so it
    // works for owewell.aidenjang.com -> api.aidenjang.com without needing 'none'.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // Share the cookie across subdomains when a parent domain is configured.
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The raw token lives only in the user's cookie. We store its SHA-256 hash as the
 * primary key, so a database leak cannot be replayed as a live session.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/** Returns the session's user, or null if the token is unknown or expired. */
export async function validateSessionToken(
  prisma: PrismaClient,
  token: string,
): Promise<User | null> {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function invalidateSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
