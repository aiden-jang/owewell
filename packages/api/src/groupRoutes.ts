import type { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env.js';
import type { Person } from './people.js';
import { createDb } from './db/client.js';
import { createGroup, deleteGroup, getGroup, listGroups, renameGroup, setGroupArchived } from './groups.js';
import { getOrCreateShareToken, revokeShareToken, rotateShareToken } from './sharing.js';
import { writeEvent } from './events.js';
import { notifyGroupChanged } from './realtime.js';

/** Register group and invite management after the caller's authentication middleware. */
export function registerGroupRoutes(api: Hono<{ Bindings: Env; Variables: { person: Person } }>): void {
  api.post('/groups', async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
    const group = await createGroup(createDb(c.env), c.get('person').id, parsed.data.name);
    writeEvent(c.env, 'group_created');
    return c.json({ group }, 201);
  });

  api.get('/groups', async (c) => {
    return c.json({ groups: await listGroups(createDb(c.env), c.get('person').id) });
  });

  api.get('/groups/:id', async (c) => {
    return c.json({ group: await getGroup(createDb(c.env), c.get('person').id, c.req.param('id')) });
  });

  api.patch('/groups/:id', async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
    const group = await renameGroup(createDb(c.env), c.get('person').id, c.req.param('id'), parsed.data.name);
    c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
    return c.json({ group });
  });

  api.post('/groups/:id/archive', async (c) => {
    const parsed = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.flatten() }, 400);
    const group = await setGroupArchived(
      createDb(c.env),
      c.get('person').id,
      c.req.param('id'),
      parsed.data.archived,
    );
    c.executionCtx.waitUntil(notifyGroupChanged(c.env, c.req.param('id')));
    return c.json({ group });
  });

  api.delete('/groups/:id', async (c) => {
    await deleteGroup(createDb(c.env), c.get('person').id, c.req.param('id'));
    return c.json({ ok: true });
  });

  // Create (or fetch) the group's public read-only share token. Members only.
  api.post('/groups/:id/share', async (c) => {
    const token = await getOrCreateShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
    writeEvent(c.env, 'share_link_minted');
    return c.json({ token });
  });

  // Mint a replacement, killing every copy of the old link. Owner-only.
  api.post('/groups/:id/share/rotate', async (c) => {
    const token = await rotateShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
    return c.json({ token });
  });

  // Remove the public view entirely. Owner-only.
  api.delete('/groups/:id/share', async (c) => {
    await revokeShareToken(createDb(c.env), c.get('person').id, c.req.param('id'));
    return c.json({ ok: true });
  });
}
