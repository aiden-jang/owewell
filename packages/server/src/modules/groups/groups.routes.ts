import type { FastifyInstance, FastifyReply } from 'fastify';
import { addMemberBody, createGroupBody, renameGroupBody } from './groups.schemas.js';
import {
  GroupError,
  addMember,
  addPlaceholderMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  renameGroup,
} from './groups.service.js';

function handleGroupError(err: unknown, reply: FastifyReply): { error: string; message: string } {
  if (err instanceof GroupError) {
    const status = err.code === 'ALREADY_MEMBER' ? 409 : err.code === 'NOT_OWNER' ? 403 : 404;
    reply.code(status);
    return { error: err.code, message: err.message };
  }
  throw err;
}

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/groups', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createGroupBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }
    const group = await createGroup(app.prisma, request.user!.id, parsed.data.name);
    reply.code(201);
    return { group };
  });

  app.get('/groups', { preHandler: app.authenticate }, async (request) => {
    return { groups: await listGroups(app.prisma, request.user!.id) };
  });

  app.get<{ Params: { id: string } }>(
    '/groups/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return { group: await getGroup(app.prisma, request.user!.id, request.params.id) };
      } catch (err) {
        return handleGroupError(err, reply);
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/groups/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = renameGroupBody.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'ValidationError', issues: parsed.error.flatten() };
      }
      try {
        return { group: await renameGroup(app.prisma, request.user!.id, request.params.id, parsed.data.name) };
      } catch (err) {
        return handleGroupError(err, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/groups/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        await deleteGroup(app.prisma, request.user!.id, request.params.id);
        return { ok: true };
      } catch (err) {
        return handleGroupError(err, reply);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/groups/:id/members',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = addMemberBody.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'ValidationError', issues: parsed.error.flatten() };
      }
      try {
        const member =
          'email' in parsed.data
            ? await addMember(app.prisma, request.user!.id, request.params.id, parsed.data.email)
            : await addPlaceholderMember(
                app.prisma,
                request.user!.id,
                request.params.id,
                parsed.data.name,
              );
        reply.code(201);
        return { member };
      } catch (err) {
        return handleGroupError(err, reply);
      }
    },
  );
}
