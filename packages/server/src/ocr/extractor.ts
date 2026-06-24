import { ClaudeReceiptExtractor } from './claude.js';
import { MockReceiptExtractor } from './mock.js';
import type { ReceiptExtractor } from './types.js';

/**
 * Real Claude OCR when an API key is configured, otherwise the zero-cost mock.
 * Read at request time so tests and local dev can flip it via the environment.
 */
export function createReceiptExtractor(): ReceiptExtractor {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeReceiptExtractor() : new MockReceiptExtractor();
}
