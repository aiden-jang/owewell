import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupMember } from '../lib/groups';

/**
 * The two ways onto the tab, behind one sheet.
 *
 * Small, but two things here are decisions rather than markup: which mode you land in when you come
 * back, and the fact that both forms report the same way. The first is a courtesy to whoever is
 * itemising a stack of receipts; the second is what keeps one of the two paths from quietly
 * growing different behaviour on save.
 */

// The forms are tested on their own. Here they are stand-ins that report which one rendered and let
// the test fire their callbacks.
vi.mock('./AddExpenseForm', () => ({
  AddExpenseForm: ({
    onCreated,
    onQueued,
  }: {
    onCreated: (e: unknown) => void;
    onQueued: (d: string) => void;
  }) => (
    <div>
      <p>simple form</p>
      <button onClick={() => onCreated({ id: 'e1' })}>save simple</button>
      <button onClick={() => onQueued('Dinner')}>queue simple</button>
    </div>
  ),
}));
vi.mock('./AddItemizedExpenseForm', () => ({
  AddItemizedExpenseForm: ({
    onCreated,
    onQueued,
  }: {
    onCreated: (e: unknown) => void;
    onQueued: (d: string) => void;
  }) => (
    <div>
      <p>itemized form</p>
      <button onClick={() => onCreated({ id: 'e2' })}>save itemized</button>
      <button onClick={() => onQueued('Receipt')}>queue itemized</button>
    </div>
  ),
}));

const member = (userId: string): GroupMember => ({
  userId,
  displayName: userId,
  email: null,
  role: 'MEMBER',
  joinedAt: '2026-08-01T00:00:00.000Z',
  isPlaceholder: false,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
});

const onCreated = vi.fn();
const onQueued = vi.fn();
const onClose = vi.fn();

async function open(over: Record<string, unknown> = {}) {
  const { AddExpenseSheet } = await import('./AddExpenseSheet');
  const sheet = (props: Record<string, unknown> = {}) => (
    <AddExpenseSheet
      open
      onClose={onClose}
      groupId="g1"
      members={[member('a'), member('b')]}
      onCreated={onCreated}
      onQueued={onQueued}
      {...over}
      {...props}
    />
  );
  const view = render(sheet());
  return { user: userEvent.setup(), setOpen: (open: boolean) => view.rerender(sheet({ open })) };
}

beforeEach(() => {
  onCreated.mockReset();
  onQueued.mockReset();
  onClose.mockReset();
});

describe('picking a mode', () => {
  it('starts on splitting a total, which is what most people are doing', async () => {
    await open();
    expect(screen.getByText('simple form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split a total' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('swaps the form and the explanation together', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Itemize a receipt' }));
    expect(screen.getByText('itemized form')).toBeInTheDocument();
    expect(screen.queryByText('simple form')).not.toBeInTheDocument();
    expect(screen.getByText(/Each item goes to the people who had it/)).toBeInTheDocument();
  });

  /*
   * Somebody itemising one receipt is usually about to itemise the next one. Resetting to the
   * default every time the sheet closes taxes the person doing the tedious job.
   */
  it('remembers which one you were on after the sheet closes', async () => {
    const { user, setOpen } = await open();
    await user.click(screen.getByRole('button', { name: 'Itemize a receipt' }));

    setOpen(false);
    setOpen(true);
    expect(screen.getByText('itemized form')).toBeInTheDocument();
  });
});

describe('what it reports', () => {
  it('says which kind was saved, so the page can name it', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'save simple' }));
    expect(onCreated).toHaveBeenCalledWith({ id: 'e1' }, 'simple');
  });

  it('says the same for a receipt', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Itemize a receipt' }));
    await user.click(screen.getByRole('button', { name: 'save itemized' }));
    expect(onCreated).toHaveBeenCalledWith({ id: 'e2' }, 'itemized');
  });

  // Queuing is identical either way: it is the same outbox and the same sentence.
  it('reports a queued write the same way from both forms', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'queue simple' }));
    expect(onQueued).toHaveBeenCalledWith('Dinner');

    await user.click(screen.getByRole('button', { name: 'Itemize a receipt' }));
    await user.click(screen.getByRole('button', { name: 'queue itemized' }));
    expect(onQueued).toHaveBeenCalledWith('Receipt');
  });
});
