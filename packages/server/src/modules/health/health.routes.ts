import type { FastifyInstance } from 'fastify';

/** Liveness + readiness: 200 only when the database actually answers. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    let db: 'up' | 'down' = 'up';
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      db = 'down';
    }

    const ok = db === 'up';
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', db, uptime: Math.round(process.uptime()) };
  });
}
