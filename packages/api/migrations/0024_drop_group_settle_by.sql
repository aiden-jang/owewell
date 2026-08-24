-- The settle-by deadline, removed. It was the same shape as the budget: an owner-set shared number,
-- null for most groups, that still put a control on every group page. Worse, it was the one thing
-- here that nagged, counting down and then reading "14h past settle-by" in a warning tone. An app
-- chasing you over money you owe a friend is the part of this category people dislike.
ALTER TABLE `groups` DROP COLUMN `settle_by`;
