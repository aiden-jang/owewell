-- Idempotency key for a recorded payment, so replaying one that may already have landed cannot log
-- the same handover twice. Unique per group, like the one on expenses.
ALTER TABLE `settlements` ADD `client_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `settle_group_client` ON `settlements` (`group_id`,`client_id`);
