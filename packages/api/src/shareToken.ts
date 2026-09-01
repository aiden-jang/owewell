// Crockford base32: no I, L, O or U, so the alphabet has no character that can be misread as
// another one and nothing in it can accidentally spell a word.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 14 characters at 5 bits each. Enough that guessing is hopeless against the rate limit on the
// lookup, and short enough that the whole link fits on one line in a message.
const LENGTH = 14;

/**
 * A share token for a new link.
 *
 * 32 divides 256 exactly, so masking a random byte with 31 picks a character with no bias.
 * Taking `byte % alphabet.length` on an alphabet that is not a power of two is the usual way
 * this goes subtly wrong.
 */
export function mintShareToken(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

// Old links are 64 lowercase hex characters and must keep working forever, so this accepts
// both shapes. Anything else never existed and can be rejected before it reaches the database.
const SHORT = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);
const LEGACY_HEX = /^[a-f0-9]{32,64}$/;

export function looksLikeShareToken(token: string): boolean {
  return SHORT.test(token) || LEGACY_HEX.test(token);
}
