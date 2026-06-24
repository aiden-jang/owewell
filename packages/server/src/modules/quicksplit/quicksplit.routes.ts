import type { FastifyInstance } from 'fastify';
import { QuickSplitError, createQuickSplit } from './quicksplit.service.js';
import { createQuickSplitBody } from './quicksplit.schemas.js';

export async function quickSplitRoutes(app: FastifyInstance): Promise<void> {
  app.post('/quick-splits', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createQuickSplitBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }

    try {
      const result = await createQuickSplit(app.prisma, request.user!.id, {
        description: parsed.data.description,
        amountCents: parsed.data.amountCents,
        splitMethod: parsed.data.splitMethod,
        participants: parsed.data.participants.map((p) => ({
          name: p.name,
          ...(p.value === undefined ? {} : { value: p.value }),
          isPayer: Boolean(p.isPayer),
          isYou: Boolean(p.isYou),
        })),
      });
      reply.code(201);
      return result;
    } catch (err) {
      if (err instanceof QuickSplitError) {
        reply.code(422);
        return { error: err.code, message: err.message };
      }
      throw err;
    }
  });
}
