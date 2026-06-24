import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, baseCookieOptions, validateSessionToken } from '../lib/session.js';
import { toPublicUser, type PublicUser } from '../modules/auth/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
  }
  interface FastifyInstance {
    /** preHandler that rejects with 401 unless a valid session cookie is present. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Wires session-cookie authentication: every request gets `request.user`, and routes
 * can guard themselves with `{ preHandler: app.authenticate }`.
 */
export default fp(
  async (app) => {
    app.decorateRequest('user', null);

    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) {
        await reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const user = await validateSessionToken(app.prisma, token);
      if (!user) {
        reply.clearCookie(SESSION_COOKIE, baseCookieOptions());
        await reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      request.user = toPublicUser(user);
    });
  },
  { name: 'auth', dependencies: ['prisma'] },
);
