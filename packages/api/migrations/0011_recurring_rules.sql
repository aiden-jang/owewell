CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_by_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`payer_id` text NOT NULL,
	`category` text,
	`cadence` text NOT NULL,
	`starts_on` text NOT NULL,
	`last_handled_on` text,
	`participant_ids` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_rules_group_active_idx` ON `recurring_rules` (`group_id`,`active`);
