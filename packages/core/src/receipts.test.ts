import { describe, expect, it } from 'vitest';
import {
  MAX_RECEIPT_BYTES,
  MAX_SCAN_BYTES,
  RECEIPT_ACCEPT,
  RECEIPT_TYPES,
  SCAN_TYPES,
  receiptRejection,
  scanRejection,
} from './index.js';

/**
 * What counts as a receipt photo.
 *
 * The server enforces this and refuses anything else; the copy here exists so nobody waits out an
 * upload to be told no. Both sides read these same constants, which is the only reason the two
 * answers cannot drift — so the thing worth pinning down is the boundary, exactly.
 */

const file = (type: string, size: number) => ({ type, size });

describe('what gets through', () => {
  it('accepts what a phone camera produces', () => {
    for (const type of RECEIPT_TYPES) {
      expect(receiptRejection(file(type, 2 * 1024 * 1024))).toBeNull();
    }
  });

  // iOS shoots HEIC by default, so refusing it would refuse the common case.
  it('accepts HEIC in particular', () => {
    expect(receiptRejection(file('image/heic', 1024))).toBeNull();
  });

  it('accepts a photo of exactly the limit', () => {
    expect(receiptRejection(file('image/jpeg', MAX_RECEIPT_BYTES))).toBeNull();
  });
});

describe('what does not', () => {
  it('turns away one byte over', () => {
    expect(receiptRejection(file('image/jpeg', MAX_RECEIPT_BYTES + 1))).not.toBeNull();
  });

  it('says how big it was and what the limit is, since the fix is picking another photo', () => {
    const why = receiptRejection(file('image/jpeg', 12.5 * 1024 * 1024));
    expect(why).toContain('12.5MB');
    expect(why).toContain('8MB');
  });

  // "12.0MB" reads like a measurement; "12MB" reads like a size.
  it('does not pad a whole number of megabytes with a decimal', () => {
    expect(receiptRejection(file('image/jpeg', 12 * 1024 * 1024))).toContain('12MB');
  });

  // A PDF receipt from an email is the plausible mistake, not a hostile upload.
  it.each(['application/pdf', 'image/gif', 'text/plain', ''])('turns away %s', (type) => {
    expect(receiptRejection(file(type, 1024))).not.toBeNull();
  });

  // Type is checked before size, so an oversized PDF is called a PDF problem.
  it('names the type problem first when a file has both', () => {
    expect(receiptRejection(file('application/pdf', MAX_RECEIPT_BYTES * 2))).toContain("isn't a photo");
  });
});

describe('the accept filter', () => {
  it('offers exactly the types that are allowed', () => {
    expect(RECEIPT_ACCEPT.split(',')).toEqual([...RECEIPT_TYPES]);
  });
});

/*
 * Scanning is a narrower question than storing.
 *
 * The model has no HEIC decoder and an iPhone shoots HEIC, so the two lists genuinely differ and the
 * gap between them is where the bug lived: HEIC used to be relabelled as JPEG and sent anyway.
 */
describe('what can be scanned', () => {
  it('is narrower than what can be stored', () => {
    expect(SCAN_TYPES.length).toBeLessThan(RECEIPT_TYPES.length);
    expect(MAX_SCAN_BYTES).toBeLessThan(MAX_RECEIPT_BYTES);
  });

  // The whole point. Storing an iPhone photo is fine; handing it to the model is not.
  it('refuses HEIC even though a receipt may be HEIC', () => {
    expect(receiptRejection(file('image/heic', 1024))).toBeNull();
    expect(scanRejection(file('image/heic', 1024))).not.toBeNull();
  });

  it('accepts what the model actually reads', () => {
    for (const type of SCAN_TYPES) {
      expect(scanRejection(file(type, 1024))).toBeNull();
    }
  });

  it('refuses an image too big to send', () => {
    expect(scanRejection(file('image/jpeg', MAX_SCAN_BYTES + 1))).not.toBeNull();
    expect(scanRejection(file('image/jpeg', MAX_SCAN_BYTES))).toBeNull();
  });

  // Every scannable type is also storable, or a scan could produce a receipt we would then refuse.
  it('never allows something the upload would turn away', () => {
    for (const type of SCAN_TYPES) {
      expect(receiptRejection(file(type, 1024))).toBeNull();
    }
  });
});
