import { hash, verify } from '@node-rs/argon2';

/** Hash a plaintext password with argon2id (library defaults are sensible and current). */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

/** Verify a password against a stored hash. Returns false on any malformed input. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
