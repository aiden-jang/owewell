import type { FastifyInstance, FastifyReply } from 'fastify';
import { GroupError } from '../groups/groups.service.js';
import {
  SettlementError,
  getSuggestedPayments,
  listSettlements,
  recordSettlement,
} from './settlements.service.js';
import { recordSettlementBody } from './settlements.schemas.js';

function handleError(err: unknown, reply: FastifyReply): { error: string; message: string } {
  if (err instanceof GroupError) {
    reply.code(404);
    return { error: err.code, message: err.message };
  }
  if (err instanceof SettlementError) {
    reply.code(422);
    return { error: err.code, message: err.message };
  }
  throw err;
}

export async function settlementRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/groups/:id/settlements',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = recordSettlementBody.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'ValidationError', issues: parsed.error.flatten() };
      }
      try {
        const settlement = await recordSettlement(
          app.prisma,
          request.user!.id,
          request.params.id,
          parsed.data,
        );
        reply.code(201);
        return { settlement };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/groups/:id/settlements',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return { settlements: await listSettlements(app.prisma, request.user!.id, request.params.id) };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/groups/:id/suggested-payments',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return {
          payments: await getSuggestedPayments(app.prisma, request.user!.id, request.params.id),
        };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
