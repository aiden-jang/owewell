import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupRecap } from '../lib/groupRecap';
import type { Settlement } from '../lib/settlements';

/**
 * The tab, wrapped.
 *
 * Composed into a block of text meant to be pasted into a group chat, so what it says — and that it
 * survives somebody dismissing the share sheet — matters more than how it looks.
 */

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('./Toast', () => ({ useToast: () => toastStub }));

const RECAP: GroupRecap = {
  totalCents: 10_400,
  largest: { description: 'Dinner at Nopa', amountCents: 8_000 },
  topCategory: { label: 'Food', emoji: '\u{1F37D}\uFE0F', amountCents: 8_000 },
  daysOpen: 3,
};
const SETTLEMENTS: Settlement[] = [
  { id: 's1', fromUserId: 'b', toUserId: 'a', amountCents: 4_000, method: 'venmo', createdAt: '2026-08-11T12:00:00.000Z' },
];

/*
 * Patch the share paths by property rather than replacing `navigator`: userEvent installs its own
 * clipboard stub during setup, and swapping the object breaks every click in the file.
 */
const patched: string[] = [];
function stubNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    patched.push(key);
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

async function open(over: Record<string, unknown> = {}) {
  const { WrappedRecap } = await import('./WrappedRecap');
  render(
    <WrappedRecap groupName="Tahoe" recap={RECAP} settlements={SETTLEMENTS} memberCount={3} {...over} />,
  );
  return userEvent.setup();
}

const shareButton = () => screen.getByRole('button', { name: /wrapped/i });

beforeEach(() => {
  toastStub.error.mockReset();
});

afterEach(() => {
  for (const key of patched.splice(0)) Reflect.deleteProperty(navigator, key);
});

describe('what it says', () => {
  it('names the group and its four numbers', async () => {
    await open();
    expect(screen.getByText('Tahoe in four numbers')).toBeInTheDocument();
    expect(screen.getByText('$104.00')).toBeInTheDocument();
    expect(screen.getByText('Dinner at Nopa')).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
  });
});

describe('sharing it', () => {
  /*
   * The text is the whole feature: it gets pasted into a group chat, so it has to stand alone. It
   * reports the totals and the highlights without replaying who owed whom, which is the one thing
   * nobody wants forwarded after the tab is closed.
   */
  it('composes a recap that reads on its own, and says nothing about individual balances', async () => {
    const user = await open();
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await user.click(shareButton());

    const { text } = share.mock.calls[0]![0];
    expect(text).toContain('Tahoe is all settled');
    expect(text).toContain('$104.00 split across 3 people');
    expect(text).toContain('1 payment recorded');
    expect(text).toContain('Biggest expense: Dinner at Nopa ($80.00)');
    expect(text).not.toMatch(/owes|is owed/);
  });

  it('pluralises the payment count', async () => {
    const user = await open({ settlements: [...SETTLEMENTS, { ...SETTLEMENTS[0]!, id: 's2' }] });
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await user.click(shareButton());
    expect(share.mock.calls[0]![0].text).toContain('2 payments recorded');
  });

  it('confirms it went', async () => {
    const user = await open();
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Wrapped shared'));
  });

  // Dismissing the OS share sheet is a decision, not a failure.
  it('goes quiet when the share sheet is dismissed', async () => {
    const user = await open();
    const writeText = vi.fn();
    stubNavigator({
      share: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
      clipboard: { writeText },
    });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Share the wrapped tab'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard where there is no share sheet', async () => {
    const user = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: undefined, clipboard: { writeText } });
    await user.click(shareButton());
    await waitFor(() => expect(shareButton()).toHaveTextContent('Wrapped copied'));
    expect(writeText.mock.calls[0]![0]).toContain('Tahoe is all settled');
  });

  it('says so when neither works', async () => {
    const user = await open();
    stubNavigator({ share: undefined, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await user.click(shareButton());
    await waitFor(() => expect(toastStub.error).toHaveBeenCalledWith('Could not share the settled recap.'));
  });
});
