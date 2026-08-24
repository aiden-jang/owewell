import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from './Confirm';

/**
 * The dialog standing between somebody and Delete group.
 *
 * It was `aria-modal="true"` with none of what that promises: Tab walked straight out into the page
 * behind it, and closing dropped focus at the top of the document. Those are the parts nobody sees
 * until they are navigating by keyboard, on the two actions in this app that cannot be undone.
 */

function Harness(): React.ReactNode {
  const confirm = useConfirm();
  return (
    <>
      <button type="button" onClick={() => void confirm({ title: 'Delete group?', body: 'Gone for good.' })}>
        Open
      </button>
      <button type="button">Behind the dialog</button>
    </>
  );
}

async function open() {
  render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog');
  return user;
}

describe('the confirm dialog', () => {
  it('opens with the answer under the cursor', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  /*
   * Two buttons, so Tab from the last wraps to the first rather than leaving. The button outside is
   * there to be reachable if the trap fails — which is exactly what used to happen.
   */
  it('keeps Tab inside it', async () => {
    const user = await open();
    const outside = screen.getByRole('button', { name: 'Behind the dialog' });

    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(outside).not.toHaveFocus();
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('holds Shift+Tab in too', async () => {
    const user = await open();
    const outside = screen.getByRole('button', { name: 'Behind the dialog' });

    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true });
      expect(outside).not.toHaveFocus();
    }
  });

  // Closing should put you back where you were, not at the top of the document.
  it('hands focus back to whatever opened it', async () => {
    const user = await open();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('DEBUG enter', async () => {
    const user = await open();
    // eslint-disable-next-line no-console
    console.log('focus before enter:', (document.activeElement as HTMLElement)?.textContent);
    let sawWindowKeydown = false;
    window.addEventListener('keydown', (e) => { if (e.key === 'Enter') sawWindowKeydown = true; });
    await user.keyboard('{Enter}');
    // eslint-disable-next-line no-console
    console.log('window saw Enter keydown:', sawWindowKeydown);
    // eslint-disable-next-line no-console
    console.log('dialog after enter:', !!screen.queryByRole('dialog'));
    expect(true).toBe(true);
  });
});
