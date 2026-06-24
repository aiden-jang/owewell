import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
    app = await buildApp(env);
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 200 and ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { status: string; db: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(typeof body.uptime).toBe('number');
  });
});
