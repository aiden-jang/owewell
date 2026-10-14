import { useCallback, useLayoutEffect, useRef } from 'react';

/** Surface lifetime and request order are separate: receipts can retain valid same-surface results. */
export function useAsyncScope(key?: string) {
  const version = useRef(0);
  const active = useRef(true);
  const scope = useRef(0);
  const scopeKey = useRef(key);
  const invalidate = useCallback(() => {
    version.current += 1;
  }, []);
  useLayoutEffect(() => {
    scopeKey.current = key;
    scope.current += 1;
    active.current = true;
    invalidate();
    return () => {
      scope.current += 1;
      active.current = false;
      invalidate();
    };
  }, [key, invalidate]);
  const begin = useCallback(() => {
    const request = ++version.current;
    return () => active.current && request === version.current;
  }, []);
  const captureScope = useCallback((expectedKey = scopeKey.current) => {
    const generation = scope.current;
    return () => active.current && generation === scope.current && expectedKey === scopeKey.current;
  }, []);
  return { begin, invalidate, captureScope };
}
