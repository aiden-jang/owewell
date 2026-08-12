-- What an expense used to say, kept when somebody edits it.
--
-- Editing overwrote in place, so a $40 dinner becoming $80 left no evidence but a moved balance. New
-- table rather than columns on `expenses`: an expense can be corrected more than once, and the point is
-- the sequence. Nothing backfills, so expenses edited before this simply have no history, which is
-- honest rather than inventing one.
CREATE TABLE `expense_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `expense_id` text NOT NULL,
  `edited_by_id` text NOT NULL,
  -- Milliseconds. Seconds would tie two edits made in the same second, making "latest" arbitrary.
  `edited_at` integer NOT NULL,
  `description` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `payer_id` text NOT NULL,
  `split_method` text NOT NULL,
  `fields` text NOT NULL,
  FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`edited_by_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `rev_expense` ON `expense_revisions` (`expense_id`);
