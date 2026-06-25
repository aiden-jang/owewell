import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, baseCookieOptions, invalidateSession } from '../../lib/session.js';
import { AuthError, changePassword, loginUser, registerUser, updateProfile } from './auth.service.js';
import { changePasswordBody, loginBody, registerBody, updateProfileBody } from './auth.schemas.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }

    try {
      const { user, token, expiresAt } = await registerUser(app.prisma, parsed.data);
      reply.setCookie(SESSION_COOKIE, token, { ...baseCookieOptions(), expires: expiresAt });
      reply.code(201);
      return { user };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(409);
        return { error: err.code, message: err.message };
      }
      throw err;
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }

    try {
      const { user, token, expiresAt } = await loginUser(app.prisma, parsed.data);
      reply.setCookie(SESSION_COOKIE, token, { ...baseCookieOptions(), expires: expiresAt });
      return { user };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401);
        return { error: err.code, message: err.message };
      }
      throw err;
    }
  });

  app.post('/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await invalidateSession(app.prisma, token);
    }
    reply.clearCookie(SESSION_COOKIE, baseCookieOptions());
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request) => {
    return { user: request.user };
  });

  app.patch('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = updateProfileBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }
    const user = await updateProfile(app.prisma, request.user!.id, parsed.data.displayName);
    return { user };
  });

  app.post('/auth/change-password', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = changePasswordBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'ValidationError', issues: parsed.error.flatten() };
    }
    try {
      await changePassword(
        app.prisma,
        request.user!.id,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(400);
        return { error: err.code, message: err.message };
      }
      throw err;
    }
  });
}
