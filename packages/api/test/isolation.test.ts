import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { seedPerson, testDb } from './helpers.js';

test('allows a test to create its own disposable person', async () => {
  await seedPerson(testDb(), 'Isolation fixture');
  expect(
    (await env.DB.prepare('SELECT COUNT(*) AS total FROM people').first<{ total: number }>())?.total,
  ).toBe(1);
});

test('starts the next test without the previous person', async () => {
  expect(
    (await env.DB.prepare('SELECT COUNT(*) AS total FROM people').first<{ total: number }>())?.total,
  ).toBe(0);
});
