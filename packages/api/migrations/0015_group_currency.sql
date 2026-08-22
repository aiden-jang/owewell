-- What a group counts in. Stored per group, not per expense: one tab is one currency, and a trip that
-- genuinely spans two is two tabs. Existing rows are dollars, which is what they have always been.
ALTER TABLE `groups` ADD `currency` text DEFAULT 'USD' NOT NULL;
