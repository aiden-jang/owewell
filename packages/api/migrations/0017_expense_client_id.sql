-- A client-chosen id for an expense, so replaying a create that may already have landed is safe.
-- Unique per group rather than globally: it is only ever used to recognise a retry of one write.
ALTER TABLE `expenses` ADD `client_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `exp_group_client` ON `expenses` (`group_id`,`client_id`);
