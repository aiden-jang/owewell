import type { FastifyInstance, FastifyReply } from 'fastify';
import { GroupError } from '../groups/groups.service.js';
import { ExpenseError, createExpense, getBalances, listExpenses } from './expenses.service.js';
import { createExpenseBody } from './expenses.schemas.js';

function handleError(err: unknown, reply: FastifyReply): { error: string; message: string } {
  if (err instanceof GroupError) {
    reply.code(404);
    return { error: err.code, message: err.message };
  }
  if (err instanceof ExpenseError) {
    reply.code(422);
    return { error: err.code, message: err.message };
  }
  throw err;
}

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/groups/:id/expenses',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = createExpenseBody.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'ValidationError', issues: parsed.error.flatten() };
      }
      const { participants, ...rest } = parsed.data;
      try {
        const expense = await createExpense(app.prisma, request.user!.id, request.params.id, {
          ...rest,
          // Drop explicit `undefined` so the shape matches the domain type under
          // exactOptionalPropertyTypes (Zod's .optional() infers `number | undefined`).
          participants: participants.map((p) =>
            p.value === undefined ? { userId: p.userId } : { userId: p.userId, value: p.value },
          ),
        });
        reply.code(201);
        return { expense };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/groups/:id/expenses',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return { expenses: await listExpenses(app.prisma, request.user!.id, request.params.id) };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/groups/:id/balances',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        return { balances: await getBalances(app.prisma, request.user!.id, request.params.id) };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
