import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import { healthRoutes } from './modules/health/health.routes.js';

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

  await app.register(prismaPlugin);
  await app.register(healthRoutes);

  return app;
}
