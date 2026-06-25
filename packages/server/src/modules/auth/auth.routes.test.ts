import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const email = `auth-test-${randomUUID()}@example.com`;
const password = 'correct horse battery';
const displayName = 'Test User';

/** Pull the session cookie out of a response so we can replay it as a request header. */
function sessionCookie(res: { cookies: { name: string; value: string }[] }): string {
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('expected a session cookie');
  return `${cookie.name}=${cookie.value}`;
}

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  test('register sets a session and /me returns the user; logout invalidates it', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password, displayName },
    });
    expect(register.statusCode).toBe(201);
    expect((register.json() as { user: { email: string } }).user.email).toBe(email);

    const cookie = sessionCookie(register);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(email);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(afterLogout.statusCode).toBe(401);
  });

  test('/auth/me without a cookie is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  test('duplicate email is rejected with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password, displayName },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('EMAIL_TAKEN');
  });

  test('login with the wrong password is 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'wrong password' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('INVALID_CREDENTIALS');
  });

  test('login with correct credentials succeeds and sets a usable session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie(login) },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(email);
  });

  test('weak password is rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `weak-${randomUUID()}@example.com`, password: 'short', displayName },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('ValidationError');
  });

  test('a user can rename themselves and change their password', async () => {
    const e = `settings-${randomUUID()}@example.com`;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: e, password: 'correct horse battery', displayName: 'Settings User' },
    });
    const c = reg.cookies.find((x) => x.name === 'owe_well_session');
    const cookie = `${c?.name}=${c?.value}`;

    const rename = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie },
      payload: { displayName: 'Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as { user: { displayName: string } }).user.displayName).toBe('Renamed');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'nope', newPassword: 'brand new password' },
    });
    expect(wrong.statusCode).toBe(400);
    expect((wrong.json() as { error: string }).error).toBe('WRONG_PASSWORD');

    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'correct horse battery', newPassword: 'brand new password' },
    });
    expect(change.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: e, password: 'correct horse battery' },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: e, password: 'brand new password' },
    });
    expect(newLogin.statusCode).toBe(200);

    await app.prisma.user.deleteMany({ where: { email: e } });
  });
});
