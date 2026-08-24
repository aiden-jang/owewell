-- A spending target is a budgeting-app job, and this is a splitter. Every other number on the group
-- page is retrospective (who paid, who owes, where it went); the budget was the one asking the group
-- to plan, and it earned a permanent "Set a budget for the trip" prompt on flatshares that never
-- would. Removed rather than tucked away, because a feature nobody reaches for is not worth a column.
ALTER TABLE `groups` DROP COLUMN `budget_cents`;
