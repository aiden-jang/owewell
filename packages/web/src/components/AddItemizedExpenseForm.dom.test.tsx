import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Expense } from '../lib/expenses';
import type { GroupMember } from '../lib/groups';

/**
 * The receipt form, driven.
 *
 * The sibling of AddExpenseForm and the more dangerous of the two, because a receipt carries more
 * places for a wrong number to hide: a per-item payer, a per-item participant list, and tax and tip
 * that ride on top of the lines. The rules that matter here are the ones where being wrong writes
 * data rather than drawing a bad screen:
 *
 *   1. Every line needs a name, a positive amount and somebody on it. A blank line saved as zero
 *      would silently shift everyone's share of the tax and tip.
 *   2. Blank tax and tip are zero; unparseable tax and tip are an error. Treating the second as the
 *      first would book a receipt that does not match the paper one.
 *   3. Reopening a receipt has to drop participants and per-item payers who have since left, or the
 *      edit re-sends people who are no longer in the group.
 */

const createItemized = vi.fn<(g: string, p: Record<string, unknown>) => Promise<Expense>>();
const updateItemized = vi.fn<(g: string, id: string, p: Record<string, unknown>) => Promise<Expense>>();
vi.mock('../lib/expenses', () => ({
  expensesApi: {
    createItemized: (g: string, p: Record<string, unknown>) => createItemized(g, p),
    updateItemized: (g: string, id: string, p: Record<string, unknown>) => updateItemized(g, id, p),
  },
}));

const enqueue = vi.fn();
const offline = { value: false };
vi.mock('../lib/outbox', () => ({
  enqueue: (row: unknown) => enqueue(row),
  isOffline: () => offline.value,
}));

const member = (userId: string, displayName: string): GroupMember => ({
  userId,
  displayName,
  email: null,
  role: 'MEMBER',
  joinedAt: '2026-01-01T00:00:00.000Z',
  isPlaceholder: false,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
});

const MEMBERS = [member('a', 'Alice'), member('b', 'Bob')];

const receipt = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  description: 'Nopa',
  amountCents: 5_000,
  payerId: 'a',
  splitMethod: 'ITEMIZED',
  category: 'food',
  createdAt: '2026-08-11T18:00:00.000Z',
  date: '2026-08-11T18:00:00.000Z',
  note: null,
  version: 7,
  splits: [],
  taxCents: 400,
  tipCents: 600,
  items: [{ name: 'Beer', amountCents: 2_000, participantIds: ['a', 'b'], payerId: 'a' }],
  ...over,
});

const onCreated = vi.fn();
const onQueued = vi.fn();

async function open(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  const { AddItemizedExpenseForm } = await import('./AddItemizedExpenseForm');
  render(
    <AddItemizedExpenseForm
      groupId="g1"
      members={MEMBERS}
      onCreated={onCreated}
      onQueued={onQueued}
      {...props}
    />,
  );
  return user;
}

/** An item's own block, so its checkboxes and payer are not confused with another line's. */
const itemBlock = (n: number): HTMLElement =>
  screen.getByLabelText(`Item ${n} name`).closest<HTMLElement>('li, div[class*="rounded"]')!;

const submit = (user: Awaited<ReturnType<typeof open>>) =>
  user.click(screen.getByRole('button', { name: /Add receipt|Save changes/ }));

async function fillLine(user: Awaited<ReturnType<typeof open>>, n: number, name: string, amount: string) {
  await user.type(screen.getByLabelText(`Item ${n} name`), name);
  await user.type(screen.getByLabelText(`Item ${n} amount`), amount);
}

beforeEach(() => {
  offline.value = false;
  for (const fn of [createItemized, updateItemized, enqueue, onCreated, onQueued]) fn.mockReset();
  createItemized.mockResolvedValue(receipt());
  updateItemized.mockResolvedValue(receipt({ version: 8 }));
  let n = 0;
  // Counted, so a queued retry reusing the pre-minted id is distinguishable from a fresh one.
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `cid-${++n}` });
});

describe('what a line has to have', () => {
  it.each([
    [
      'no name',
      async (u: Awaited<ReturnType<typeof open>>) => u.type(screen.getByLabelText('Item 1 amount'), '20'),
    ],
    [
      'no amount',
      async (u: Awaited<ReturnType<typeof open>>) => u.type(screen.getByLabelText('Item 1 name'), 'Beer'),
    ],
  ])('refuses a line with %s', async (_case, fill) => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fill(user);
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Each item needs a name, an amount, and at least one person.',
    );
    expect(createItemized).not.toHaveBeenCalled();
  });

  // A line nobody is on cannot be apportioned, so it would quietly vanish from everyone's share.
  it('refuses a line with nobody on it', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    for (const m of MEMBERS) {
      await user.click(within(itemBlock(1)).getByRole('checkbox', { name: m.displayName }));
    }
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('at least one person');
    expect(createItemized).not.toHaveBeenCalled();
  });

  /*
   * A receipt with no lines is not a receipt, so the only line has no remove button at all rather
   * than one that silently does nothing. (`removeItem` refuses as well, belt and braces.)
   */
  it('offers no way to delete the only line, and offers one as soon as there are two', async () => {
    const user = await open();
    expect(screen.queryByLabelText('Remove item 1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add another item/ }));
    expect(screen.getByLabelText('Item 2 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove item 1')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Remove item 2'));
    expect(screen.queryByLabelText('Item 2 name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove item 1')).not.toBeInTheDocument();
  });
});

describe('tax and tip', () => {
  it('counts blank as nothing rather than refusing', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await submit(user);
    await waitFor(() => expect(createItemized).toHaveBeenCalled());
    expect(createItemized.mock.calls[0]![1]).toMatchObject({ taxCents: 0, tipCents: 0 });
  });

  it('sends them in cents when given', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await user.type(screen.getByLabelText('Tax'), '1.75');
    await user.type(screen.getByLabelText('Tip'), '4');
    await submit(user);
    await waitFor(() => expect(createItemized).toHaveBeenCalled());
    expect(createItemized.mock.calls[0]![1]).toMatchObject({ taxCents: 175, tipCents: 400 });
  });

  // Unparseable is not the same as absent: booking it as zero makes the saved receipt disagree
  // with the printed one, and nothing downstream would notice.
  it('refuses a tax it cannot read rather than calling it zero', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await user.type(screen.getByLabelText('Tax'), 'about four');
    await submit(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Check the tax and tip amounts.');
    expect(createItemized).not.toHaveBeenCalled();
  });

  it('adds the lines, the tax and the tip into the total on screen', async () => {
    const user = await open();
    await fillLine(user, 1, 'Beer', '20');
    await user.type(screen.getByLabelText('Tax'), '1.75');
    await user.type(screen.getByLabelText('Tip'), '4');
    expect(screen.getByText('$25.75')).toBeInTheDocument();
  });
});

describe('per-item payers', () => {
  it('defaults each line to whoever paid the receipt, and sends it', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await submit(user);
    await waitFor(() => expect(createItemized).toHaveBeenCalled());
    expect(createItemized.mock.calls[0]![1]).toMatchObject({
      items: [{ name: 'Beer', amountCents: 2_000, participantIds: ['a', 'b'], payerId: 'a' }],
    });
  });

  it('lets one line be paid by somebody else', async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await user.selectOptions(screen.getByLabelText('Item 1 paid by'), 'b');
    await submit(user);
    await waitFor(() => expect(createItemized).toHaveBeenCalled());
    expect(createItemized.mock.calls[0]![1]).toMatchObject({ payerId: 'a', items: [{ payerId: 'b' }] });
  });
});

describe('reopening a receipt', () => {
  it('prefills the lines, tax and tip that were saved', async () => {
    await open({ editing: receipt() });
    expect(screen.getByLabelText('Item 1 name')).toHaveValue('Beer');
    expect(screen.getByLabelText('Item 1 amount')).toHaveValue('20.00');
    expect(screen.getByLabelText('Tax')).toHaveValue('4.00');
    expect(screen.getByLabelText('Tip')).toHaveValue('6.00');
  });

  /*
   * People who have left cannot be re-sent. Both the participant list and the per-item payer are
   * ids that were valid when the receipt was saved and may not be now.
   */
  it('drops participants who are no longer in the group', async () => {
    const user = await open({
      editing: receipt({
        items: [{ name: 'Beer', amountCents: 2_000, participantIds: ['a', 'gone'], payerId: 'a' }],
      }),
    });
    await submit(user);
    await waitFor(() => expect(updateItemized).toHaveBeenCalled());
    expect(updateItemized.mock.calls[0]![2]).toMatchObject({ items: [{ participantIds: ['a'] }] });
  });

  it('falls back to the receipt payer when the line payer has left', async () => {
    const user = await open({
      editing: receipt({
        items: [{ name: 'Beer', amountCents: 2_000, participantIds: ['a'], payerId: 'gone' }],
      }),
    });
    await submit(user);
    await waitFor(() => expect(updateItemized).toHaveBeenCalled());
    expect(updateItemized.mock.calls[0]![2]).toMatchObject({ items: [{ payerId: 'a' }] });
  });

  it('sends the version it was based on; a new receipt has none', async () => {
    const user = await open({ editing: receipt() });
    await submit(user);
    await waitFor(() => expect(updateItemized).toHaveBeenCalled());
    expect(updateItemized.mock.calls[0]![2]).toMatchObject({ expectedVersion: 7 });
  });
});

describe('when it cannot reach the server', () => {
  it('queues the receipt under the id the failed attempt used', async () => {
    offline.value = true;
    createItemized.mockRejectedValue(new Error('offline'));
    const user = await open();
    await user.type(screen.getByPlaceholderText('What was it for?'), 'Nopa');
    await fillLine(user, 1, 'Beer', '20');
    await submit(user);
    await waitFor(() => expect(enqueue).toHaveBeenCalled());
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      kind: 'itemized',
      clientId: 'cid-1',
      payload: { clientId: 'cid-1' },
    });
    expect(onQueued).toHaveBeenCalledWith('Nopa');
  });

  it('queues an edit as an edit-itemized', async () => {
    offline.value = true;
    updateItemized.mockRejectedValue(new Error('offline'));
    const user = await open({ editing: receipt() });
    await submit(user);
    await waitFor(() => expect(enqueue).toHaveBeenCalled());
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ kind: 'edit-itemized', expenseId: 'e1' });
  });
});
