const key = 'owewell:last-verified-account';

export function lastAccount(): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberLastAccount(ownerId: string | null): void {
  try {
    if (ownerId) sessionStorage.setItem(key, ownerId);
    else sessionStorage.removeItem(key);
  } catch {
    // Recovery in another document requires browser storage.
  }
}
