import { useState } from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@owewell/core';
import { SelectField } from './SelectField';

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
    <SelectField
      wrapperClassName={className}
      value={value}
      onChange={(event) => onChange(event.target.value as PaymentMethod)}
      onPointerDown={() => setPointerFocus(true)}
      onKeyDown={() => setPointerFocus(false)}
      onBlur={() => setPointerFocus(false)}
      data-pointer-focus={pointerFocus || undefined}
      aria-label="Payment method"
      className="payment-method-select rounded-xl border border-line bg-field py-2.5 pl-3 text-base text-ink sm:text-sm"
    >
      {PAYMENT_METHODS.map((method) => (
        <option key={method} value={method}>
          {PAYMENT_METHOD_LABELS[method]}
        </option>
      ))}
    </SelectField>
  );
}
