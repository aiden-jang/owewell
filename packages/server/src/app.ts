import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
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
import { quickSplitRoutes } from './modules/quicksplit/quicksplit.routes.js';

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

  // Liveness stays at the root for load-balancer health checks.
  await app.register(healthRoutes);

  // Everything else lives under /api so it never collides with client routes
  // (e.g. the SPA's /groups/:id) when the web app is served from the same origin.
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(groupRoutes);
      await api.register(expenseRoutes);
      await api.register(settlementRoutes);
      await api.register(inviteRoutes);
      await api.register(ocrRoutes);
      await api.register(quickSplitRoutes);
    },
    { prefix: '/api' },
  );

  await registerWebApp(app, env);

  return app;
}

/**
 * In production, serve the built web app from the same origin and fall back to
 * index.html for client-side routes. Skipped entirely when WEB_DIR is unset (dev/test).
 */
async function registerWebApp(app: FastifyInstance, env: Env): Promise<void> {
  if (!env.WEB_DIR) return;
  await app.register(fastifyStatic, { root: env.WEB_DIR });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      !request.url.startsWith('/ws')
    ) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'NotFound' });
  });
}
