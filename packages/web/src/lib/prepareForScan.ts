import { MAX_SCAN_BYTES, SCAN_TYPES } from '@owewell/core';

/*
 * Getting a phone photo into something the vision model will read.
 *
 * Two problems, one answer. An iPhone shoots HEIC, which the model cannot decode — but Safari on
 * that same iPhone decodes it natively, so drawing it to a canvas and reading it back as JPEG turns
 * the one device that produces the problem into the one that solves it. And a modern phone photo is
 * several megabytes of detail the model does not use; downscaling makes the request small enough to
 * be quick over a restaurant's wifi.
 *
 * Best-effort by design. A browser that cannot decode the file leaves it untouched and the server
 * refuses it with a clear reason, which is a better outcome than failing here with a vaguer one.
 */

/** Wide enough that receipt small print survives, small enough to send over a phone connection. */
const MAX_EDGE = 1600;
const QUALITY = 0.85;

/**
 * How long to wait for the browser to decode before giving up on converting.
 *
 * A decode that never settles would otherwise leave the scan button spinning with nothing behind it,
 * which is worse than sending the original and letting the server answer.
 */
const DECODE_MS = 4000;

function drawn(image: HTMLImageElement): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => reject(new Error('decode timed out')), DECODE_MS);
    const settle = (fn: () => void) => () => {
      window.clearTimeout(timer);
      fn();
    };
    image.onload = settle(() => resolve(image));
    image.onerror = settle(() => reject(new Error('decode failed')));
    image.src = url;
  });
}

export async function prepareForScan(file: File): Promise<File> {
  // Already small and already readable: sending it untouched costs nothing and re-encoding would
  // only throw detail away.
  const readable = (SCAN_TYPES as readonly string[]).includes(file.type);
  if (readable && file.size <= MAX_SCAN_BYTES / 2) return file;

  // Everything from here is inside the try, object URL included: this promises never to throw, and
  // a environment without createObjectURL would otherwise break that before the try began.
  let url: string | undefined;
  try {
    url = URL.createObjectURL(file);
    const canvas = drawn(await load(url));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
