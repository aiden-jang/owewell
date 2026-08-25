import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from './Toast';

/**
 * The toast, and the one thing about it that broke silently: it wore `glass` for a while after
 * `glass` was deleted from index.css. TypeScript doesn't read CSS, eslint doesn't read CSS, and an
 * undefined class is legal HTML, so it just rendered as bare text on nothing.
 *
 * The pairing is asserted from both ends — the element wears the class, the stylesheet defines it.
 * Either half alone passes while the bug is live.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function Fire({ tone = 'success' }: { tone?: 'success' | 'error' } = {}): null {
  const toast = useToast();
  if (tone === 'error') toast.error('Could not remove them.');
  else toast.success('Removed them from the group.');
  return null;
}

describe('the toast pill', () => {
  it('wears the class, and the stylesheet defines it', () => {
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    );
    const pill = screen.getByText('Removed them from the group.').closest('[class]')!;
    // Named, not "some class that happens to be defined": the broken version carried four Tailwind
    // utilities and one dead name, and a looser check passes on the strength of the utilities.
    expect(pill.className.split(/\s+/)).toContain('toast');
    expect(CSS).toMatch(/^\.toast\s*\{/m);
  });

  /*
   * A toast is the only surface that lands on top of another surface, so it cannot be the card
   * colour: fired from inside a sheet it would be #121215 on #121215 behind a hairline. This is why
   * it has its own role rather than reusing `.surface`.
   */
  it('is a different surface from the cards it covers', () => {
    const rule = /\.toast\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, '.toast is not defined in index.css').not.toBeNull();
    expect(rule![1]).toContain('--color-surface2');
    expect(rule![1]).toContain('--float');
  });
});

/*
 * The tone cue is drawn, not typed.
 *
 * It was ⚠️ and ✓ — one a full-colour emoji, so the single element in the app that has to read
 * instantly was also the one every platform draws differently, at 14px, where a platform emoji is a
 * smudge. Both are Icon paths now, inheriting the toast's own text colour.
 */
describe('the tone cue', () => {
  it.each([
    ['error', 'Could not remove them.'],
    ['success', 'Removed them from the group.'],
  ] as const)('%s draws an icon rather than an emoji', (tone, message) => {
    render(
      <ToastProvider>
        <Fire tone={tone} />
      </ToastProvider>,
    );
    const pill = screen.getByText(message).closest('[class]')!;
    expect(pill.querySelector('svg'), 'no icon in the toast').not.toBeNull();
    // Any astral-plane character here is a colour emoji that slipped back in.
    expect(pill.textContent ?? '').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
