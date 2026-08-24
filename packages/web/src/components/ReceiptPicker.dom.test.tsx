import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECEIPT_BYTES } from '@owewell/core';
import { ReceiptPicker } from './ReceiptPicker';

/**
 * Choosing a photo, and being told straight away when it will not do.
 *
 * The accept filter is a hint, not a gate: a phone hands over a 30MB burst shot happily and "All
 * files" is one tap away on some pickers. Without this the file sat in the form until submit and
 * failed after the upload — the one moment a person has already committed to waiting.
 */

const onChange = vi.fn();

/** A File of a given size without allocating it: jsdom reports whatever `size` says. */
function fakeFile(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const input = () => screen.getByLabelText('Receipt photo') as HTMLInputElement;

beforeEach(() => onChange.mockReset());

describe('a photo that will do', () => {
  it('is handed up', async () => {
    const user = userEvent.setup();
    render(<ReceiptPicker file={null} onChange={onChange} />);
    const ok = fakeFile('receipt.jpg', 'image/jpeg', 2 * 1024 * 1024);
    await user.upload(input(), ok);
    expect(onChange).toHaveBeenCalledWith(ok);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('a photo that will not', () => {
  it('is refused for being too big, with the numbers', async () => {
    const user = userEvent.setup();
    render(<ReceiptPicker file={null} onChange={onChange} />);
    await user.upload(input(), fakeFile('huge.jpg', 'image/jpeg', MAX_RECEIPT_BYTES + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('8MB');
  });

  /*
   * Not handed up at all. Holding it and failing on submit is the behaviour this replaces, and it
   * would also leave the form claiming a photo it is about to lose.
   */
  it('never reaches the form', async () => {
    const user = userEvent.setup();
    render(<ReceiptPicker file={null} onChange={onChange} />);
    await user.upload(input(), fakeFile('huge.jpg', 'image/jpeg', MAX_RECEIPT_BYTES + 1));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'huge.jpg' }));
  });

  /*
   * `applyAccept: false` on purpose. userEvent honours the accept attribute and would drop this
   * before the component ever saw it, which is stricter than a real picker: "All files" is one tap
   * away on some platforms and a drag-and-drop ignores accept entirely. The attribute is a hint, and
   * this is the check behind it.
   */
  it('is refused for not being an image', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ReceiptPicker file={null} onChange={onChange} />);
    await user.upload(input(), fakeFile('receipt.pdf', 'application/pdf', 1024));
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't a photo/);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // The message has to go when a good one follows, or it reads as a standing complaint.
  it('stops complaining once a good photo replaces it', async () => {
    const user = userEvent.setup();
    render(<ReceiptPicker file={null} onChange={onChange} />);
    await user.upload(input(), fakeFile('huge.jpg', 'image/jpeg', MAX_RECEIPT_BYTES + 1));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.upload(input(), fakeFile('fine.jpg', 'image/jpeg', 1024));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
