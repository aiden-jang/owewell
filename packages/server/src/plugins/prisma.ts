import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Connects a single PrismaClient and exposes it as `app.prisma`.
 * Registered via fastify-plugin so the decoration is visible app-wide,
 * and disconnected cleanly on shutdown.
 */
export default fp(
  async (app) => {
    const prisma = new PrismaClient();
    await prisma.$connect();

    app.decorate('prisma', prisma);
    app.addHook('onClose', async (instance) => {
      await instance.prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
