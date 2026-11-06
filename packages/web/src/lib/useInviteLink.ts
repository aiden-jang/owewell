import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { groupsApi, type GroupDetail } from './groups';
import { useToast } from '../components/Toast';
import { useAsyncScope } from './useAsyncScope';
import { ApiError } from './api';

// Minting an invite writes a token; request it only when inviting is needed or explicitly chosen.

/** How long the Copy button admits it copied. */
const COPIED_MS = 1600;

export interface InviteLink {
  /** The full URL, once minted. Null until something asks for it. */
  link: string | null;
  copied: boolean;
  changing: boolean;
  sharingOff: boolean;
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
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState(false);
  const changingRef = useRef(false);
  const copyVersion = useRef(0);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const unclaimed = (group?.members ?? []).filter((m) => m.isPlaceholder).length;
  const needsPeople = !!group && !group.archived && ((group.members?.length ?? 0) === 1 || unclaimed > 0);

  const groupId = group?.id;
  const sharingOff = !link && (revoked || !!group?.shareDisabled);
  const { begin, captureScope } = useAsyncScope(groupId);
  useLayoutEffect(() => {
    setLink(null);
    setRevoked(false);
    setCopied(false);
    changingRef.current = false;
    setChanging(false);
    window.clearTimeout(copiedTimer.current);
  }, [groupId]);
  useLayoutEffect(() => {
    setRevoked(!!group?.shareDisabled);
    if (group?.shareDisabled) {
      setLink(null);
      setCopied(false);
    }
  }, [group?.shareDisabled]);
  const mint = useCallback(async (): Promise<string | null> => {
    if (!groupId) return null;
    const token = await groupsApi.createShareLink(groupId);
    return `${window.location.origin}/s/${token}`;
  }, [groupId]);

  // Fetched on its own when the group needs people, so the block has something to show without
  // waiting for a tap. Gated on needsPeople because minting is a write; see the note above.
  useEffect(() => {
    if (!needsPeople || link || sharingOff) return;
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
  }, [needsPeople, link, mint, sharingOff, begin]);

  const reveal = useCallback(async (): Promise<void> => {
    if (changingRef.current) return;
    const current = begin();
    changingRef.current = true;
    setChanging(true);
    let url: string | null;
    try {
      url =
        sharingOff && groupId
          ? `${window.location.origin}/s/${await groupsApi.rotateShare(groupId)}`
          : await mint();
    } catch (error) {
      if (current())
        toast.error(error instanceof ApiError ? error.message : 'Could not create a share link.');
      return;
    } finally {
      if (current()) {
        changingRef.current = false;
        setChanging(false);
      }
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
  }, [group?.name, groupId, mint, sharingOff, toast, begin]);

  const changeLink = useCallback(
    async (turnOff: boolean): Promise<void> => {
      if (!groupId || changingRef.current) return;
      const current = begin();
      changingRef.current = true;
      setChanging(true);
      copyVersion.current += 1;
      window.clearTimeout(copiedTimer.current);
      setCopied(false);
      try {
        let token: string | null = null;
        if (turnOff) await groupsApi.revokeShare(groupId);
        else token = await groupsApi.rotateShare(groupId);
        if (!current()) return;
        setRevoked(turnOff);
        setLink(token ? `${window.location.origin}/s/${token}` : null);
        toast.success(
          turnOff
            ? 'Link turned off. Members keep their access.'
            : 'New link ready. The old one stopped working.',
        );
      } catch (err) {
        if (current()) toast.error(err instanceof Error ? err.message : 'Could not update the share link.');
      } finally {
        if (current()) {
          changingRef.current = false;
          setChanging(false);
        }
      }
    },
    [groupId, toast, begin],
  );

  const copy = useCallback(async (): Promise<void> => {
    if (!link || changingRef.current) return;
    const sameGroup = captureScope();
    const version = ++copyVersion.current;
    const current = () => sameGroup() && version === copyVersion.current;
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
  }, [link, toast, captureScope]);

  return {
    link,
    copied,
    changing,
    sharingOff,
    needsPeople,
    unclaimed,
    reveal,
    copy,
    rotate: () => changeLink(false),
    revoke: () => changeLink(true),
  };
}
