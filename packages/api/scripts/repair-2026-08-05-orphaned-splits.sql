-- One-off data repair: 2026-08-05
--
-- Group   c79c98e3-6ae5-4315-ae63-452a7896d66e
-- Moves   b1f2bc12-e262-4b28-86ae-20deaaaf4f88  ("david", placeholder, no seat, 6 splits, 15814c)
-- Onto    7a404c69-fb06-49f8-b59c-eadf23961017  ("David Seo", real account, holds the MEMBER seat)
--
-- Why: David Seo claimed the "david" placeholder seat. The membership row moved and the splits did
-- not, so computeBalances counted a seatless person and then discarded him, the balances stopped
-- summing to zero, and /settlements/suggested returned {"error":"INTERNAL"} from then on.
--
-- NOT a migration. It repairs one group's rows and must never run twice on a different dataset.
-- Take a backup first:
--   npx wrangler d1 export owewell --remote --output ~/owewell-backup-20260805.sql
--
-- Run ONLY after the preview in the same directory shows `collisions = 0`. If it shows any, stop and
-- use the merge form instead: repointing onto an expense David Seo already has a split on violates the
-- unique index on (expense_id, person_id), and the two rows have to be summed rather than renamed.

UPDATE expense_splits
SET person_id = '7a404c69-fb06-49f8-b59c-eadf23961017'
WHERE person_id = 'b1f2bc12-e262-4b28-86ae-20deaaaf4f88'
  AND expense_id IN (
    SELECT id FROM expenses WHERE group_id = 'c79c98e3-6ae5-4315-ae63-452a7896d66e'
  )
  -- Belt and braces: skip anything that would collide, so a stray row can't abort the statement.
  AND expense_id NOT IN (
    SELECT expense_id FROM expense_splits
    WHERE person_id = '7a404c69-fb06-49f8-b59c-eadf23961017'
  );
