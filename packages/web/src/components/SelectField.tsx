import type { ComponentPropsWithoutRef } from 'react';
import { Icon } from './Icon';

export function SelectField({
  wrapperClassName = '',
  ...props
}: ComponentPropsWithoutRef<'select'> & { wrapperClassName?: string }) {
  return (
    <span className={`select-field ${wrapperClassName}`}>
      <select {...props} />
      <Icon name="chevron-down" size={16} className="select-chevron" />
    </span>
  );
}
