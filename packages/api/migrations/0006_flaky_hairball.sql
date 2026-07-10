ALTER TABLE `groups` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_share_token_unique` ON `groups` (`share_token`);