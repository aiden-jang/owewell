import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ExtractedReceipt, ReceiptExtractor } from './types.js';

const ResponseSchema = z.object({
  items: z.array(z.object({ name: z.string(), amountCents: z.number().int().nonnegative() })),
  taxCents: z.number().int().nonnegative().default(0),
  tipCents: z.number().int().nonnegative().default(0),
});

const PROMPT = `You are reading a photo of a receipt. Extract the line items, plus tax and tip.
Respond with ONLY a JSON object, no prose and no code fences, shaped exactly like:
{"items":[{"name":"string","amountCents":integer}],"taxCents":integer,"tipCents":integer}
All amounts are integer cents (e.g. $12.50 is 1250). If tax or tip is not shown, use 0.`;

type SupportedMedia = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function toMediaType(mimeType: string): SupportedMedia {
  switch (mimeType) {
    case 'image/png':
      return 'image/png';
    case 'image/gif':
      return 'image/gif';
    case 'image/webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/**
 * Real OCR via Claude vision. Uses Haiku 4.5 — the cheapest vision-capable model —
 * since this is a low-cost, low-volume use case. Activated only when an
 * ANTHROPIC_API_KEY is present (see the extractor factory).
 */
export class ClaudeReceiptExtractor implements ReceiptExtractor {
  private readonly client = new Anthropic();

  async extract(image: Buffer, mimeType: string): Promise<ExtractedReceipt> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: toMediaType(mimeType), data: image.toString('base64') },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    const parsed = ResponseSchema.parse(JSON.parse(text));
    return { items: parsed.items, taxCents: parsed.taxCents, tipCents: parsed.tipCents };
  }
}
