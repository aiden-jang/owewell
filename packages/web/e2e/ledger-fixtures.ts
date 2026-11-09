import { expect, signIn, type Page } from './fixtures';

export async function read(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  return response.json();
}

export async function dinner(page: Page, guests = ['Sam'], name = 'Dinner group') {
  await signIn(page);
  const { personId } = await read(page, '/api/me');
  const created = await page.request.post('/api/groups', { data: { name } });
  expect(created.ok()).toBe(true);
  const { group } = await created.json();
  const url = `/groups/${group.id}`;
  const path = `/api${url}`;
  const participants = [{ userId: personId }];
  const guestIds: string[] = [];
  for (const guest of guests) {
    const added = await page.request.post(path + '/members', { data: { name: guest } });
    expect(added.ok()).toBe(true);
    const { member } = await added.json();
    guestIds.push(member.userId);
    participants.push({ userId: member.userId });
  }
  const amountCents = 2000 * participants.length;
  const recorded = await page.request.post(path + '/expenses', {
    data: { description: 'Dinner', amountCents, payerId: personId, participants, splitMethod: 'EQUAL' },
  });
  expect(recorded.ok()).toBe(true);
  return { path, url, personId, guestIds, expense: (await recorded.json()).expense };
}

export async function share(page: Page, path: string): Promise<string> {
  const response = await page.request.post(path + '/share');
  expect(response.ok()).toBe(true);
  return (await response.json()).token;
}

export const queuedKinds = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]').map((row: { kind: string }) => row.kind),
  );

export const record = { name: 'Record payment', exact: true };
export async function confirmPayment(page: Page) {
  await page.getByRole('button', record).click();
  const confirmation = page.getByRole('dialog', { name: 'Record this payment?' });
  await expect(confirmation).toContainText('Sam paid Robin $20.00');
  return confirmation.getByRole('button', record);
}
