import type { ExtractedReceipt, ReceiptExtractor } from './types.js';

/**
 * Deterministic stand-in used when no OCR provider is configured. Lets the whole
 * upload -> extract -> prefill flow run end to end at zero cost and with no key.
 */
export class MockReceiptExtractor implements ReceiptExtractor {
  extract(): Promise<ExtractedReceipt> {
    return Promise.resolve({
      items: [
        { name: 'Margherita pizza', amountCents: 1800 },
        { name: 'Caesar salad', amountCents: 1200 },
        { name: 'Sparkling water', amountCents: 400 },
      ],
      taxCents: 340,
      tipCents: 0,
    });
  }
}
