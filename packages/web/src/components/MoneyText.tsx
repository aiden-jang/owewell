import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMoney } from '../lib/currency';

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Money that counts up to its value when it first appears or changes. Purely
 * presentational polish; the final rendered figure is always the exact `cents`.
 */
export function MoneyText({
  cents,
  className = '',
  duration = 650,
}: {
  cents: number;
  className?: string;
  duration?: number;
}): ReactNode {
  const fmt = useMoney();
  const [shown, setShown] = useState(cents);
  const fromRef = useRef(cents);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (REDUCED || fromRef.current === cents) {
      setShown(cents);
      fromRef.current = cents;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (cents - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = cents;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [cents, duration]);

  return <span className={`tnum ${className}`}>{fmt(shown)}</span>;
}
