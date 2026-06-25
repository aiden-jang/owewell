import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import type { EmailMessage, EmailTransport } from '../../lib/email.js';
import { loginUser, requestPasswordReset, resetPassword } from './auth.service.js';

class CapturingTransport implements EmailTransport {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

const email = `reset-${randomUUID()}@example.com`;
const password = 'correct horse battery';

describe('password reset', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password, displayName: 'Reset User' },
    });
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  test('a reset link lets a user set a new password; the link is single-use', async () => {
    const transport = new CapturingTransport();
    await requestPasswordReset(app.prisma, email, 'https://owewell.example', transport);

    expect(transport.sent).toHaveLength(1);
    const token = new URL(transport.sent[0]!.text.match(/https:\/\/\S+/)![0]).searchParams.get('token');
    expect(token).toBeTruthy();

    await resetPassword(app.prisma, token!, 'a brand new password');

    // Old password no longer works; the new one does.
    await expect(loginUser(app.prisma, { email, password })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const ok = await loginUser(app.prisma, { email, password: 'a brand new password' });
    expect(ok.user.email).toBe(email);

    // The token can't be reused.
    await expect(resetPassword(app.prisma, token!, 'another password')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  test('requesting a reset for an unknown email is a silent no-op', async () => {
    const transport = new CapturingTransport();
    await requestPasswordReset(app.prisma, `nobody-${randomUUID()}@example.com`, 'https://x', transport);
    expect(transport.sent).toHaveLength(0);
  });

  test('forgot-password endpoint always returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: `whoever-${randomUUID()}@example.com` },
    });
    expect(res.statusCode).toBe(200);
  });

  test('reset-password rejects a bogus token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'not-a-real-token', newPassword: 'a brand new password' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('INVALID_TOKEN');
  });
});
