import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import type { Env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { groupRoutes } from './modules/groups/groups.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { settlementRoutes } from './modules/settlements/settlements.routes.js';
import { inviteRoutes } from './modules/invites/invites.routes.js';
import realtimePlugin from './realtime/realtime.plugin.js';
import { ocrRoutes } from './modules/ocr/ocr.routes.js';

function loggerOptions(env: Env): NonNullable<FastifyServerOptions['logger']> {
  if (env.NODE_ENV === 'test') return false;
  if (env.NODE_ENV === 'development') {
    return {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return true;
}

/** Build a fully wired Fastify instance. Kept separate from listening so tests can inject. */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(env) });

  await app.register(cookie);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(realtimePlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(groupRoutes);
  await app.register(expenseRoutes);
  await app.register(settlementRoutes);
  await app.register(inviteRoutes);
  await app.register(ocrRoutes);

  return app;
}
