import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryDot, CategoryGlyph } from './CategoryMark';

/**
 * Two renderings of one idea, and the split between them.
 *
 * They were all emoji, then all dots, and both blanket answers were wrong somewhere. What is worth
 * pinning is that each still does its own job, and that neither ever speaks: the category is named
 * in text at every site, so a screen reader reading "house building" or "purple circle" first would
 * be repeating the label badly.
 */

describe('CategoryGlyph', () => {
  it('shows the category glyph', () => {
    const { container } = render(<CategoryGlyph categoryKey="lodging" />);
    expect(container.textContent).toBe('🏨');
  });

  // Legacy rows carry category keys that no longer exist; Other is the fallback, not a crash.
  it('falls back for a category the app no longer has', () => {
    const { container } = render(<CategoryGlyph categoryKey="crypto" />);
    expect(container.textContent).toBe('🧾');
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<CategoryGlyph categoryKey="food" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden');
  });
});

describe('CategoryDot', () => {
  /*
   * The chart hue, not a colour of its own. A bar, a slice and this dot read from one variable, so
   * a category cannot come out one colour in the donut and another in the list beside it.
   */
  it('takes the hue the charts give that category', () => {
    const { container } = render(<CategoryDot categoryKey="transport" />);
    expect(container.firstElementChild).toHaveAttribute(
      'style',
      expect.stringContaining('--p-cat-transport'),
    );
  });

  it('falls back to a neutral rather than to nothing', () => {
    const { container } = render(<CategoryDot categoryKey="crypto" />);
    expect(container.firstElementChild!.getAttribute('style')).toContain('--p-faint');
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<CategoryDot categoryKey="food" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden');
  });
});
