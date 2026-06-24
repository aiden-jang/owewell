import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      className={`inline-flex w-full items-center justify-center rounded-full bg-accent px-5 py-3 font-semibold text-white shadow-sm transition duration-150 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
