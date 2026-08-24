import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SCAN_BYTES } from '@owewell/core';
import { prepareForScan } from './prepareForScan';

/**
 * Getting a photo ready to scan, and never making things worse by trying.
 *
 * The conversion itself needs a real canvas, so what is pinned here is the contract around it: this
 * is best-effort, and every path that cannot convert has to hand back something sendable rather than
 * throw. jsdom has no canvas at all, which makes it a good stand-in for the browser that cannot
 * decode the file — the exact case the fallback exists for.
 */

function fakeFile(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/*
 * Whether it reached for the canvas at all, which is the only visible difference here: jsdom has no
 * canvas, so both branches end up returning the original file and only the attempt distinguishes them.
 */
function watchAttempts(): { count: () => number } {
  const created = vi.fn(() => 'blob:stub');
  Object.defineProperty(URL, 'createObjectURL', { value: created, configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  return { count: () => created.mock.calls.length };
}

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('a photo that needs nothing done to it', () => {
  // Re-encoding a small JPEG would only throw detail away for no gain.
  it('is handed straight back', async () => {
    const small = fakeFile('receipt.jpg', 'image/jpeg', 200_000);
    expect(await prepareForScan(small)).toBe(small);
  });

  it('does not even reach for the canvas', async () => {
    const attempts = watchAttempts();
    await prepareForScan(fakeFile('receipt.jpg', 'image/jpeg', 200_000));
    expect(attempts.count()).toBe(0);
  });

  // Scannable type but big enough to be worth shrinking, so the shortcut does not apply: the branch
  // is on both, not on type alone.
  it('still shrinks a large one of a good type', async () => {
    vi.useFakeTimers();
    const attempts = watchAttempts();
    const done = prepareForScan(fakeFile('receipt.jpg', 'image/jpeg', MAX_SCAN_BYTES));
    expect(attempts.count()).toBe(1);
    // jsdom never fires onload, which is exactly the stalled decode the timeout is for.
    await vi.advanceTimersByTimeAsync(4000);
    await expect(done).resolves.toBeInstanceOf(File);
    vi.useRealTimers();
  });
});

describe('when the browser cannot help', () => {
  /*
   * The desktop-Chrome-meets-HEIC case. Failing here would replace a clear server refusal with a
   * vaguer client one, so it gives back the original and lets the server say why.
   */
  it('gives back the original rather than throwing', async () => {
    const heic = fakeFile('IMG_0001.HEIC', 'image/heic', 4_000_000);
    await expect(prepareForScan(heic)).resolves.toBe(heic);
  });

  it('survives a file that is not an image at all', async () => {
    const pdf = fakeFile('receipt.pdf', 'application/pdf', 1024);
    await expect(prepareForScan(pdf)).resolves.toBe(pdf);
  });
});
