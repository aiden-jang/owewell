import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupDetail, GroupMember } from './groups';

/**
 * The invite link, and the reason it is not just a button.
 *
 * Minting the token is a write: the server creates one if the group has none. So the up-front fetch
 * is gated on the group actually needing people, and the gate is the thing worth testing — a
 * "simplification" that drops it would quietly mint a token for every group anybody ever opens.
 */

const createShareLink = vi.fn<(id: string) => Promise<string>>();
const rotateShare = vi.fn<(id: string) => Promise<string>>();
const revokeShare = vi.fn<(id: string) => Promise<void>>();
vi.mock('./groups', () => ({
  groupsApi: {
    createShareLink: (id: string) => createShareLink(id),
    rotateShare: (id: string) => rotateShare(id),
    revokeShare: (id: string) => revokeShare(id),
  },
}));

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../components/Toast', () => ({ useToast: () => toastStub }));

const member = (userId: string, isPlaceholder = false): GroupMember => ({
  userId,
  displayName: userId,
  email: isPlaceholder ? null : `${userId}@x.z`,
  role: 'MEMBER',
  joinedAt: '2026-08-01T00:00:00.000Z',
  isPlaceholder,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
});

const group = (members: GroupMember[], archived = false): GroupDetail => ({
  id: 'g1',
  name: 'Tahoe',
  createdById: 'a',
  createdAt: '2026-08-01T00:00:00.000Z',
  archived,
  members,
});

/** Two real members, nobody outstanding: the link has done its job. */
const SETTLED_ROSTER = group([member('a'), member('b')]);
/** Just you. */
const SOLO = group([member('a')]);
/** Somebody added by name who has not signed in. */
const HAS_PLACEHOLDER = group([member('a'), member('b', true), member('c', true)]);

const patched: string[] = [];
function stubNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    patched.push(key);
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

async function open(g: GroupDetail | null) {
  const { useInviteLink } = await import('./useInviteLink');
  return renderHook(({ current }) => useInviteLink(current), { initialProps: { current: g } });
}

beforeEach(() => {
  createShareLink.mockReset().mockResolvedValue('tok123');
  rotateShare.mockReset().mockResolvedValue('tok999');
  revokeShare.mockReset().mockResolvedValue(undefined);
  toastStub.error.mockReset();
  toastStub.success?.mockReset?.();
});

afterEach(() => {
  for (const key of patched.splice(0)) Reflect.deleteProperty(navigator, key);
  vi.useRealTimers();
});

describe('when the link is fetched without being asked for', () => {
  it('does not show another group’s link after switching groups', async () => {
    const { result, rerender } = await open(SOLO);
    await waitFor(() => expect(result.current.link).toContain('tok123'));
    createShareLink.mockReturnValue(new Promise(() => {}));
    rerender({ current: { ...SOLO, id: 'g2' } });
    expect(result.current.link).toBeNull();
    expect(createShareLink).toHaveBeenCalledWith('g2');
  });
  /*
   * The whole reason the gate exists. Minting is a write, so a group that has no use for an invite
   * must not get a token created on it just because somebody opened the page.
   */
  it('is not, for a group that already has its people', async () => {
    const { result } = await open(SETTLED_ROSTER);
    await waitFor(() => expect(result.current.needsPeople).toBe(false));
    expect(createShareLink).not.toHaveBeenCalled();
    expect(result.current.link).toBeNull();
  });

  it('is not, before the group has loaded', async () => {
    await open(null);
    expect(createShareLink).not.toHaveBeenCalled();
  });

  // An archived group is read-only and off your list. Nobody is being invited to it.
  it('is not, for an archived group that would otherwise qualify', async () => {
    const { result } = await open(group([member('a')], true));
    await waitFor(() => expect(result.current.needsPeople).toBe(false));
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('is, when it is just you in the group', async () => {
    const { result } = await open(SOLO);
    await waitFor(() => expect(result.current.link).toBe('http://localhost:3000/s/tok123'));
    expect(createShareLink).toHaveBeenCalledWith('g1');
  });

  it('is, while somebody is still in by name only', async () => {
    const { result } = await open(HAS_PLACEHOLDER);
    await waitFor(() => expect(result.current.link).not.toBeNull());
    expect(result.current.unclaimed).toBe(2);
  });

  it('happens once, not on every render', async () => {
    const { result, rerender } = await open(SOLO);
    await waitFor(() => expect(result.current.link).not.toBeNull());
    rerender({ current: SOLO });
    rerender({ current: SOLO });
    expect(createShareLink).toHaveBeenCalledTimes(1);
  });

  // The header's Invite button still works, so there is nothing to tell anybody about yet.
  it('says nothing when the up-front fetch fails', async () => {
    createShareLink.mockRejectedValue(new Error('offline'));
    const { result } = await open(SOLO);
    await waitFor(() => expect(createShareLink).toHaveBeenCalled());
    expect(result.current.link).toBeNull();
    expect(toastStub.error).not.toHaveBeenCalled();
  });
});

describe('asking for it', () => {
  it('mints one for a group that had no reason to fetch it up front', async () => {
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.reveal());
    expect(result.current.link).toBe('http://localhost:3000/s/tok123');
  });

  /*
   * Title and url, never a text body. This is an invite, so the share sheet's own Copy has to copy
   * the link — give iOS a text body and it copies that instead, and the person pastes a sentence
   * where a link was meant to go.
   */
  it('offers the share sheet the link and nothing else', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.reveal());

    expect(share).toHaveBeenCalledWith({
      title: 'Join "Tahoe" on owewell',
      url: 'http://localhost:3000/s/tok123',
    });
    expect(share.mock.calls[0]![0]).not.toHaveProperty('text');
  });

  // Dismissing the sheet is not a failure, and the link is already on screen behind it.
  it('leaves the link up when the share sheet is dismissed', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error('dismissed')) });
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.reveal());
    expect(result.current.link).toBe('http://localhost:3000/s/tok123');
    expect(toastStub.error).not.toHaveBeenCalled();
  });

  it('reveals it even where there is no share sheet at all', async () => {
    stubNavigator({ share: undefined });
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.reveal());
    expect(result.current.link).not.toBeNull();
  });

  // Asked for directly, so a failure has somebody waiting on it.
  it('says so when the mint fails', async () => {
    createShareLink.mockRejectedValue(new Error('nope'));
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.reveal());
    expect(toastStub.error).toHaveBeenCalledWith('Could not create a share link.');
    expect(result.current.link).toBeNull();
  });
});

describe('copying it', () => {
  it('confirms, then stops confirming', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result } = await open(SOLO);
    await waitFor(() => expect(result.current.link).not.toBeNull());

    // Fake timers only once the up-front fetch has settled: waitFor needs the real ones to resolve.
    vi.useFakeTimers();
    await act(() => result.current.copy());
    expect(result.current.copied).toBe(true);
    act(() => void vi.advanceTimersByTime(1600));
    expect(result.current.copied).toBe(false);
  });

  it('copies the link itself', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    const { result } = await open(SOLO);
    await waitFor(() => expect(result.current.link).not.toBeNull());

    await act(() => result.current.copy());
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/s/tok123');
  });

  // The link is visible on screen, so there is always a manual way out.
  it('points at the visible link when the clipboard refuses', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const { result } = await open(SOLO);
    await waitFor(() => expect(result.current.link).not.toBeNull());

    await act(() => result.current.copy());
    expect(toastStub.error).toHaveBeenCalledWith(expect.stringContaining('copy it manually'));
    expect(result.current.copied).toBe(false);
  });

  it('does nothing before there is a link', async () => {
    const writeText = vi.fn();
    stubNavigator({ clipboard: { writeText } });
    const { result } = await open(SETTLED_ROSTER);
    await act(() => result.current.copy());
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not leave its timer running into a component that is gone', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result, unmount } = await open(SOLO);
    await waitFor(() => expect(result.current.link).not.toBeNull());

    vi.useFakeTimers();
    await act(() => result.current.copy());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/*
 * Taking the link back.
 *
 * The trap here is the auto-mint above: it fires whenever the group still needs people and there is
 * no link in hand, which is precisely the state revoking creates. The first version of this turned
 * the link off and then immediately minted a replacement, so the button looked broken while quietly
 * doing the opposite of what it said.
 */
describe('turning the link off', () => {
  it('does not immediately mint a replacement', async () => {
    const { result } = await open(HAS_PLACEHOLDER);
    await waitFor(() => expect(result.current.link).toContain('tok123'));
    createShareLink.mockClear();

    await act(() => result.current.revoke());

    expect(revokeShare).toHaveBeenCalledWith('g1');
    expect(result.current.link).toBeNull();
    // The group still needs people, so the auto-mint would fire if nothing held it back.
    await new Promise((r) => setTimeout(r, 0));
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('lets you deliberately ask for a link again afterwards', async () => {
    const { result } = await open(HAS_PLACEHOLDER);
    await waitFor(() => expect(result.current.link).toContain('tok123'));
    await act(() => result.current.revoke());

    createShareLink.mockResolvedValue('tok456');
    await act(() => result.current.reveal());
    expect(result.current.link).toContain('tok456');
  });
});

describe('replacing the link', () => {
  it('swaps in the new token', async () => {
    const { result } = await open(HAS_PLACEHOLDER);
    await waitFor(() => expect(result.current.link).toContain('tok123'));

    await act(() => result.current.rotate());
    expect(rotateShare).toHaveBeenCalledWith('g1');
    expect(result.current.link).toContain('tok999');
  });

  it('keeps the link on screen when the server refuses', async () => {
    const { result } = await open(HAS_PLACEHOLDER);
    await waitFor(() => expect(result.current.link).toContain('tok123'));

    rotateShare.mockRejectedValue(new Error('Only the owner can do that.'));
    await act(() => result.current.rotate());
    expect(result.current.link).toContain('tok123');
    expect(toastStub.error).toHaveBeenCalled();
  });
});
