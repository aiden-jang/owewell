import type { KeyboardEvent } from 'react';

/** Enter advances text inputs; saving remains an explicit button action. */
export function advanceFormField(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || ['checkbox', 'radio', 'date'].includes(field.type)) return;
  const form = field.form;
  if (!form) return;
  event.preventDefault();
  const fields = Array.from(
    form.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button[type="submit"]:not([disabled])',
    ),
  ).filter((item) => item.getClientRects().length > 0);
  const next = fields[fields.indexOf(field) + 1];
  next?.focus();
  next?.scrollIntoView({ block: 'center', behavior: 'auto' });
}
