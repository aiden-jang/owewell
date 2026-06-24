import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';

const emailA = `ocr-a-${randomUUID()}@example.com`;
const emailB = `ocr-b-${randomUUID()}@example.com`;
const password = 'correct horse battery';

interface Registered {
  cookie: string;
  id: string;
}

async function register(app: FastifyInstance, email: string, name: string): Promise<Registered> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, displayName: name },
  });
  const cookie = res.cookies.find((c) => c.name === 'owe_well_session');
  if (!cookie) throw new Error('no session cookie');
  return { cookie: `${cookie.name}=${cookie.value}`, id: (res.json() as { user: { id: string } }).user.id };
}

/** Build a minimal multipart/form-data body with one file field. */
function multipartBody(bytes: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----owewelltest${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('ocr route (mock extractor)', () => {
  let app: FastifyInstance;
  let ann: Registered;
  let bob: Registered;
  let groupId = '';

  beforeAll(async () => {
    // Force the zero-cost mock extractor regardless of the ambient environment.
    delete process.env.ANTHROPIC_API_KEY;
    app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test' }));
    ann = await register(app, emailA, 'Ann');
    bob = await register(app, emailB, 'Bob');
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      headers: { cookie: ann.cookie },
      payload: { name: 'Dinner' },
    });
    groupId = (created.json() as { group: { id: string } }).group.id;
  });

  afterAll(async () => {
    const users = await app.prisma.user.findMany({
      where: { email: { in: [emailA, emailB] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await app.prisma.group.deleteMany({ where: { createdById: { in: ids } } });
    await app.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  test('extracts line items from an uploaded receipt', async () => {
    const { body, contentType } = multipartBody(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/ocr`,
      headers: { cookie: ann.cookie, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const receipt = (res.json() as { receipt: { items: { amountCents: number }[]; taxCents: number } })
      .receipt;
    expect(receipt.items).toHaveLength(3);
    expect(receipt.items.reduce((sum, i) => sum + i.amountCents, 0)).toBe(3400);
    expect(receipt.taxCents).toBe(340);
  });

  test('a non-member cannot use OCR on the group', async () => {
    const { body, contentType } = multipartBody(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.inject({
      method: 'POST',
      url: `/groups/${groupId}/ocr`,
      headers: { cookie: bob.cookie, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});
