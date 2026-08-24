import { useCallback, useEffect, useRef, useState } from 'react';
import { groupsApi, type GroupDetail } from './groups';
import { useToast } from '../components/Toast';

/*
 * The link that gets other people into the group.
 *
 * Two things make this more than a button. Minting the token is a WRITE — the server creates one if
 * the group has none — so it cannot be done speculatively on every group anyone opens. And the link
 * is a one-time action on a permanent surface, so it earns a place on screen only while it is still
 * the obvious next step: nobody else in the group yet, or people in it by name who have not claimed
 * their spot. After that it goes back to being a button in the header.
 *
 * So the token is fetched up front exactly when `needsPeople` says it is about to be shown, and
 * otherwise waits to be asked for.
 */

/** How long the Copy button admits it copied. */
const COPIED_MS = 1600;

export interface InviteLink {
  /** The full URL, once minted. Null until something asks for it. */
  link: string | null;
  copied: boolean;
  /** Still the obvious next step, which is what earns it a place on the page. */
  needsPeople: boolean;
  /** Members who are in the group by name only. */
  unclaimed: number;
  /** Mint it, put it on screen, and offer the share sheet where there is one. */
  reveal: () => Promise<void>;
  copy: () => Promise<void>;
  /** Swap in a new token. Every copy of the old link stops working. Owner-only on the server. */
  rotate: () => Promise<void>;
  /** Turn the public view off entirely. Owner-only on the server. */
  revoke: () => Promise<void>;
}

export function useInviteLink(group: GroupDetail | null): InviteLink {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  /*
   * Blocks the auto-mint below after a deliberate revoke.
   *
   * That effect mints whenever the group still needs people and there is no link in hand — which is
   * exactly the state revoking produces. Without this, turning the link off immediately created a
   * replacement and the button appeared to do nothing at all. Session-only: reopening the group is a
   * fresh decision, and the group genuinely does still need people.
   */
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const unclaimed = (group?.members ?? []).filter((m) => m.isPlaceholder).length;
  const needsPeople = !!group && !group.archived && ((group.members?.length ?? 0) === 1 || unclaimed > 0);

  const groupId = group?.id;
  const mint = useCallback(async (): Promise<string | null> => {
    if (!groupId) return null;
    const token = await groupsApi.createShareLink(groupId);
    return `${window.location.origin}/s/${token}`;
  }, [groupId]);

  // Fetched on its own when the group needs people, so the block has something to show without
  // waiting for a tap. Gated on needsPeople because minting is a write; see the note above.
  useEffect(() => {
    if (!needsPeople || link || revoked) return;
    let alive = true;
    void mint()
      .then((url) => {
        if (alive && url) setLink(url);
      })
      .catch(() => undefined); // the header's Invite button still works
    return () => {
      alive = false;
    };
  }, [needsPeople, link, mint, revoked]);

  const reveal = useCallback(async (): Promise<void> => {
    let url: string | null;
    try {
      url = await mint();
    } catch {
      toast.error('Could not create a share link.');
      return;
    }
    if (!url) return;
    // On screen no matter what the browser supports, before anything else is attempted.
    setRevoked(false);
    setLink(url);
    /*
     * Then the share sheet, on the phones that have one. Title and url only, never a text body:
     * this is an invite, so the sheet's own Copy has to copy the link — a text body makes iOS copy
     * that instead. A dismissed sheet is not an error; the link is already visible below.
     */
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join "${group?.name}" on owewell`, url });
      } catch {
        /* dismissed */
      }
    }
  }, [group?.name, mint, toast]);

  /*
   * Both of these break links other people already hold, which is the point of them, so both say so
   * plainly afterwards rather than succeeding in silence.
   *
   * Rotating keeps the panel open on the replacement, because the next thing you want is to send it.
   * Revoking clears it, because there is nothing left to send.
   */
  const rotate = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    try {
      const token = await groupsApi.rotateShare(groupId);
      setRevoked(false);
      setLink(`${window.location.origin}/s/${token}`);
      toast.success('New link ready. The old one stopped working.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make a new link.');
    }
  }, [groupId, toast]);

  const revoke = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    try {
      await groupsApi.revokeShare(groupId);
      setRevoked(true);
      setLink(null);
      toast.success('Link turned off. Members keep their access.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not turn the link off.');
    }
  }, [groupId, toast]);

  const copy = useCallback(async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  }, [link, toast]);

  return { link, copied, needsPeople, unclaimed, reveal, copy, rotate, revoke };
}
