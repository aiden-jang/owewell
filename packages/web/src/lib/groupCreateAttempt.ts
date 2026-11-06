export interface GroupCreateAttempt {
  ownerId: string | undefined;
  name: string;
  clientId: string;
}

const key = 'owewell:group-create:v1';

export function rememberGroupCreate(
  name: string,
  ownerId: string | undefined,
  current: GroupCreateAttempt | null,
): GroupCreateAttempt {
  let stored: GroupCreateAttempt | null = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    // The form can still retry in memory when browser storage is unavailable.
  }
  const previous = current ?? stored;
  if (
    previous &&
    previous.name === name &&
    previous.ownerId === ownerId &&
    typeof previous.clientId === 'string'
  ) {
    return previous;
  }
  const attempt = { name, ownerId, clientId: crypto.randomUUID() };
  try {
    sessionStorage.setItem(key, JSON.stringify(attempt));
  } catch {
    // The caller retains the attempt for retries while the page is open.
  }
  return attempt;
}

export function finishGroupCreate(clientId: string): void {
  try {
    const stored: GroupCreateAttempt | null = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (stored?.clientId === clientId) sessionStorage.removeItem(key);
  } catch {
    // The current request already succeeded.
  }
}
