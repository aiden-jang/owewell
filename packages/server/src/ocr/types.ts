export interface ExtractedItem {
  name: string;
  amountCents: number;
}

export interface ExtractedReceipt {
  items: ExtractedItem[];
  taxCents: number;
  tipCents: number;
}

/** Turns a receipt image into structured line items. Implementations are swappable. */
export interface ReceiptExtractor {
  extract(image: Buffer, mimeType: string): Promise<ExtractedReceipt>;
}
