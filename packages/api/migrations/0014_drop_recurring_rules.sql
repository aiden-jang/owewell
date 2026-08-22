-- Recurring bills are gone: a schedule that proposes expenses was more machinery than the app earned,
-- and duplicating a past expense covers the same ground without a second source of truth for a bill.
DROP INDEX IF EXISTS `recurring_rules_group_active_idx`;
--> statement-breakpoint
DROP TABLE IF EXISTS `recurring_rules`;
