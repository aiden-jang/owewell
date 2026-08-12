-- An optional spending target for the whole group, in cents.
--
-- Nullable with no default, so every existing group reads as "no budget" rather than as a group that has
-- set one of zero. The distinction matters: the UI shows nothing at all for null and would otherwise
-- show every flatshare a budget bar it never asked for.
ALTER TABLE `groups` ADD `budget_cents` integer;
