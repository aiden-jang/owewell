ALTER TABLE `groups` ADD COLUMN `create_client_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_create_attempt` ON `groups` (`created_by_id`, `create_client_id`);
--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN `share_disabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- An existing null token may be a revocation. Leave those groups private until an owner enables sharing.
UPDATE `groups` SET `share_disabled` = 1 WHERE `share_token` IS NULL;
