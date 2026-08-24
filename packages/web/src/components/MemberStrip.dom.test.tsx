import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GroupMember } from '../lib/groups';
import { MemberStrip } from './MemberStrip';

/**
 * The roster at a glance.
 *
 * Two things are worth holding: the count stays truthful past the point where the faces stop, and
 * the whole thing is one control rather than a row of decorative circles. The avatars are aria-hidden
 * (an initial in a coloured disc says nothing to a screen reader), so the button's own label is the
 * only place the number is spoken.
 */

const roster = (n: number): GroupMember[] =>
  Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    displayName: `Person ${i}`,
    email: null,
    role: 'MEMBER' as const,
    joinedAt: '2026-08-01T00:00:00.000Z',
    isPlaceholder: false,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
  }));

describe('MemberStrip', () => {
  it('opens the roster when pressed', async () => {
    const onOpen = vi.fn();
    render(<MemberStrip members={roster(3)} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });

  /*
   * Six people, five faces. The overflow chip is the only thing carrying the other one, so if it
   * silently dropped them the strip would under-report the group.
   */
  it('counts the people the faces do not fit', () => {
    render(<MemberStrip members={roster(8)} onOpen={vi.fn()} />);
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('8 people')).toBeInTheDocument();
  });

  it('shows every face when they all fit, and no chip', () => {
    render(<MemberStrip members={roster(4)} onOpen={vi.fn()} />);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    expect(screen.getByText('4 people')).toBeInTheDocument();
  });

  // "1 people" is the reason this is a special case rather than a template.
  it('says who is there when it is only you', () => {
    render(<MemberStrip members={roster(1)} onOpen={vi.fn()} />);
    expect(screen.getByText('Just you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1 member\./ })).toBeInTheDocument();
  });

  // The count lives on the button, because the discs themselves are aria-hidden.
  it('speaks the count to a screen reader', () => {
    render(<MemberStrip members={roster(5)} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^5 members\./ })).toBeInTheDocument();
  });
});
