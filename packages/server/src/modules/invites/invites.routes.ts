import type { FastifyInstance, FastifyReply } from 'fastify';
import { GroupError } from '../groups/groups.service.js';
import { InviteError, acceptInvite, createInvite, getInviteInfo } from './invites.service.js';
import { createInviteBody } from './invites.schemas.js';

function handleError(err: unknown, reply: FastifyReply): { error: string; message: string } {
  if (err instanceof GroupError) {
    reply.code(404);
    return { error: err.code, message: err.message };
  }
  if (err instanceof InviteError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'EXPIRED' ? 410 : 409;
    reply.code(status);
    return { error: err.code, message: err.message };
  }
  throw err;
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/groups/:id/invites',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = createInviteBody.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'ValidationError', issues: parsed.error.flatten() };
      }
      try {
        const invite = await createInvite(
          app.prisma,
          request.user!.id,
          request.params.id,
          parsed.data.email,
        );
        reply.code(201);
        return { invite };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // Public: lets the invite landing page show the group before the user signs in.
  app.get<{ Params: { token: string } }>('/invites/:token', async (request, reply) => {
    try {
      return { invite: await getInviteInfo(app.prisma, request.params.token) };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post<{ Params: { token: string } }>(
    '/invites/:token/accept',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return await acceptInvite(app.prisma, request.user!.id, request.params.token);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
