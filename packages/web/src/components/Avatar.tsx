import type { ReactNode } from 'react';

// Evenly spaced OKLCH hues share perceptual lightness. Dark ink preserves label contrast.

/* Hexes live in lib/contrast.ts, read here as CSS vars so a disc follows the theme by itself. */
const BUCKETS = 10;

/*
 * FNV-1a plus murmur3's finalizer. Don't drop the finalizer: picking a colour is `hash % 10`, which
 * reads the low bits, and FNV alone doesn't avalanche those on strings as short as a first name —
 * fifty names piled thirteen onto one colour.
 */
function bucketFor(name: string): number {
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % BUCKETS;
}

/** Exported so the spread can be measured; nothing else should care how a colour is chosen. */
export function avatarBucket(name: string): number {
  return bucketFor(name);
}

const DIMS = { xs: 'h-6 w-6 text-2xs', sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm' } as const;

export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof DIMS }): ReactNode {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${DIMS[size]}`}
      style={{ backgroundColor: `var(--p-av-${bucketFor(name)})`, color: 'var(--p-av-ink)' }}
    >
      {initial}
    </span>
  );
}
