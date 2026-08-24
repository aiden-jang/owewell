import { z } from 'zod';
import { SCAN_TYPES, type ExtractedReceipt } from '@owewell/core';
import type { Env } from './env.js';

const MOCK: ExtractedReceipt = {
  items: [
    { name: 'Margherita pizza', amountCents: 1800 },
    { name: 'Caesar salad', amountCents: 1200 },
    { name: 'Sparkling water', amountCents: 400 },
  ],
  taxCents: 340,
  tipCents: 0,
};

const ResponseSchema = z.object({
  items: z.array(z.object({ name: z.string(), amountCents: z.number().int().nonnegative() })),
  taxCents: z.number().int().nonnegative().default(0),
  tipCents: z.number().int().nonnegative().default(0),
});

const PROMPT = `You are reading a photo of a receipt. Extract the line items, plus tax and tip.
Respond with ONLY a JSON object, no prose and no code fences, shaped exactly like:
{"items":[{"name":"string","amountCents":integer}],"taxCents":integer,"tipCents":integer}
All amounts are integer cents (e.g. $12.50 is 1250). If tax or tip is not shown, use 0.`;

/*
 * Send the type the bytes actually are.
 *
 * This used to fall back to 'image/jpeg' for anything it did not recognise, which meant HEIC — what
 * an iPhone shoots — went to the model as JPEG and came back as a failure nobody could act on. The
 * route refuses unsupported types now, so this only has to be honest about the ones that get through.
 */
function mediaType(mimeType: string): string {
  return (SCAN_TYPES as readonly string[]).includes(mimeType) ? mimeType : 'image/jpeg';
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Claude vision when ANTHROPIC_API_KEY is set (cheapest Haiku model), else the zero-cost mock. */
export async function extractReceipt(env: Env, image: ArrayBuffer, mimeType: string): Promise<ExtractedReceipt> {
  if (!env.ANTHROPIC_API_KEY) return MOCK;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType(mimeType), data: toBase64(image) } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const parsed = ResponseSchema.parse(JSON.parse(text));
  return { items: parsed.items, taxCents: parsed.taxCents, tipCents: parsed.tipCents };
}
