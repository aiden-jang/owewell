import { useContext, useEffect, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

export interface BlockedNavigation {
  reset: () => void;
  proceed: () => void;
}

function NavigationBlocker({
  dirty,
  onBlocked,
}: {
  dirty: boolean;
  onBlocked: (navigation: BlockedNavigation) => void;
}): ReactNode {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === 'blocked') onBlocked({ reset: blocker.reset, proceed: blocker.proceed });
  }, [blocker, onBlocked]);
  return null;
}

/** Standalone sheets can render without a router; production uses a data router for back protection. */
export function SheetNavigationGuard(props: {
  dirty: boolean;
  onBlocked: (navigation: BlockedNavigation) => void;
}): ReactNode {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <NavigationBlocker {...props} /> : null;
}
