import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-gradient',
  secondary: 'border border-line-strong bg-surface2 text-ink hover:border-accent',
  ghost: 'border border-line text-muted hover:bg-surface2 hover:text-ink',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  block = true,
  className = '',
  ...props
}: ButtonProps): ReactNode {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
        block ? 'w-full' : ''
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
