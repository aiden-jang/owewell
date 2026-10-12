import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShareAction } from './useShareAction';

/**
 * The share flow, once, instead of five times.
 *
 * The branch that earns this file is the dismissed share sheet. Backing out of it throws
 * `AbortError`, and reading that as a failure means falling through to the clipboard and writing
 * something the person just declined to send. It was correct in all five copies, which is exactly
 * the situation where the sixth copy gets it wrong.
 */

const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

/*
 * Patched by property rather than by replacing `navigator`: jsdom's navigator has no `share`, and
 * swapping the whole object out breaks anything else reading from it.
 */
const patched: string[] = [];
function stubNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    patched.push(key);
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

const report = vi.fn();
const payload = {
  title: 'Tahoe settle-up',
  text: 'Bob pays Alice $30.00',
  failureMessage: 'Could not share that.',
};

beforeEach(() => {
  report.mockReset();
});

afterEach(() => {
  for (const key of patched.splice(0)) Reflect.deleteProperty(navigator, key);
  vi.useRealTimers();
});

describe('the share sheet', () => {
  it('copies directly when the action explicitly asks for the clipboard', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share, clipboard: { writeText } });
    const { result } = renderHook(() => useShareAction(report));
    await act(() => result.current.share({ ...payload, copyOnly: true }));
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(payload.text);
    expect(result.current.status).toBe('copied');
  });

  it('gets the title and the text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(share).toHaveBeenCalledWith({ title: 'Tahoe settle-up', text: 'Bob pays Alice $30.00' });
    expect(result.current.status).toBe('shared');
  });

  /*
   * The branch this file exists for. A dismissed sheet is an answer, and the old copies were careful
   * to stop there rather than "helpfully" putting the text on the clipboard instead.
   */
  it('stops dead when the sheet is dismissed, without touching the clipboard', async () => {
    const writeText = vi.fn();
    stubNavigator({ share: vi.fn().mockRejectedValue(abort()), clipboard: { writeText } });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(writeText).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  // Any other rejection is the sheet not working, which the clipboard can still answer.
  it('falls through to the clipboard when the sheet actually fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error('no permission')), clipboard: { writeText } });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(writeText).toHaveBeenCalledWith('Bob pays Alice $30.00');
    expect(result.current.status).toBe('copied');
  });
});

describe('without a share sheet', () => {
  it('copies, and says copied rather than shared', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: undefined, clipboard: { writeText } });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(writeText).toHaveBeenCalledWith('Bob pays Alice $30.00');
    expect(result.current.status).toBe('copied');
  });

  it('hands the caller its own words when the clipboard refuses', async () => {
    stubNavigator({
      share: undefined,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    // The message is the caller's, because "could not share your balance" and "could not share that
    // reminder" are different sentences on different buttons.
    expect(report).toHaveBeenCalledWith('Could not share that.');
    expect(result.current.status).toBeNull();
  });
});

describe('what the button says afterwards', () => {
  it('goes back to resting after a couple of seconds', async () => {
    vi.useFakeTimers();
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(result.current.status).toBe('shared');
    act(() => void vi.advanceTimersByTime(2200));
    expect(result.current.status).toBeNull();
  });

  // A nudge panel that reopens on a different row should not inherit the last row's confirmation.
  it('can be dropped early', async () => {
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    act(() => result.current.reset());
    expect(result.current.status).toBeNull();
  });

  /*
   * The settle-up panel disappears the moment the last debt clears, which can happen inside the two
   * seconds the confirmation is up. The old copies left the timer running into an unmounted tree.
   */
  it('does not leave its timer running into a component that is gone', async () => {
    vi.useFakeTimers();
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    const { result, unmount } = renderHook(() => useShareAction(report));

    await act(() => result.current.share(payload));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    // Counting the timer rather than watching for a crash: React 18 lets a setState on an unmounted
    // component pass in silence, so "it did not throw" would have been true with no cleanup at all.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a second press while the first is in flight', () => {
  it('is ignored', async () => {
    let release: () => void = () => {};
    const share = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    stubNavigator({ share });
    const { result } = renderHook(() => useShareAction(report));

    let first: Promise<void>;
    act(() => {
      first = result.current.share(payload);
    });
    await waitFor(() => expect(result.current.status).toBe('sharing'));

    await act(() => result.current.share(payload));
    expect(share).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await first;
    });
    expect(result.current.status).toBe('shared');
  });
});
