import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { groupsApi, type GroupDetail } from './groups';
import { useToast } from '../components/Toast';
import { useAsyncScope } from './useAsyncScope';

// Minting an invite writes a token; request it only when inviting is needed or explicitly chosen.

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
  // Suppress auto-mint after revocation for this visit so turning the link off stays off.
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const unclaimed = (group?.members ?? []).filter((m) => m.isPlaceholder).length;
  const needsPeople = !!group && !group.archived && ((group.members?.length ?? 0) === 1 || unclaimed > 0);

  const groupId = group?.id;
  const { begin } = useAsyncScope(groupId);
  useLayoutEffect(() => {
    setLink(null);
    setRevoked(false);
    setCopied(false);
    window.clearTimeout(copiedTimer.current);
  }, [groupId]);
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
    const current = begin();
    void mint()
      .then((url) => {
        if (alive && current() && url) setLink(url);
      })
      .catch(() => undefined); // the header's Invite button still works
    return () => {
      alive = false;
    };
  }, [needsPeople, link, mint, revoked, begin]);

  const reveal = useCallback(async (): Promise<void> => {
    const current = begin();
    let url: string | null;
    try {
      url = await mint();
    } catch {
      if (current()) toast.error('Could not create a share link.');
      return;
    }
    if (!current() || !url) return;
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
  }, [group?.name, mint, toast, begin]);

  const rotate = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    const current = begin();
    try {
      const token = await groupsApi.rotateShare(groupId);
      if (!current()) return;
      setRevoked(false);
      setLink(`${window.location.origin}/s/${token}`);
      toast.success('New link ready. The old one stopped working.');
    } catch (err) {
      if (current()) toast.error(err instanceof Error ? err.message : 'Could not make a new link.');
    }
  }, [groupId, toast, begin]);

  const revoke = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    const current = begin();
    try {
      await groupsApi.revokeShare(groupId);
      if (!current()) return;
      setRevoked(true);
      setLink(null);
      toast.success('Link turned off. Members keep their access.');
    } catch (err) {
      if (current()) toast.error(err instanceof Error ? err.message : 'Could not turn the link off.');
    }
  }, [groupId, toast, begin]);

  const copy = useCallback(async (): Promise<void> => {
    if (!link) return;
    const current = begin();
    window.clearTimeout(copiedTimer.current);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      if (!current()) return;
      setCopied(true);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      if (current()) toast.error('Copy failed. Select the link and copy it manually.');
    }
  }, [link, toast, begin]);

  return { link, copied, needsPeople, unclaimed, reveal, copy, rotate, revoke };
}
