-- Bumped on every edit, so an edit can say which version of the row it was written against. Without
-- it the last write always wins silently, which is tolerable over the seconds an online edit takes
-- and not over the hours an edit queued offline can wait.
ALTER TABLE `expenses` ADD `version` integer DEFAULT 1 NOT NULL;
