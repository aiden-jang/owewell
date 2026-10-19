import { useState } from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { Icon } from './Icon';

export function PaymentMethodSelect({
  value,
  onChange,
  className = '',
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  className?: string;
}) {
  const [pointerFocus, setPointerFocus] = useState(false);
  return (
    <span className={`payment-method-field relative inline-flex ${className}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PaymentMethod)}
        onPointerDown={() => setPointerFocus(true)}
        onKeyDown={() => setPointerFocus(false)}
        onBlur={() => setPointerFocus(false)}
        data-pointer-focus={pointerFocus || undefined}
        aria-label="Payment method"
        className="payment-method-select w-full appearance-none rounded-xl border border-line bg-field py-2.5 pl-3 pr-9 text-base text-ink outline-none sm:text-sm"
      >
        {PAYMENT_METHODS.map((method) => (
          <option key={method} value={method}>
            {PAYMENT_METHOD_LABELS[method]}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-right"
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-muted"
      />
    </span>
  );
}
