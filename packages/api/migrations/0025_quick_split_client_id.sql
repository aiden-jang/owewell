ALTER TABLE `groups` ADD COLUMN `quick_split_client_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_quick_split_attempt` ON `groups` (`created_by_id`, `quick_split_client_id`);
