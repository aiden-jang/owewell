-- An optional line of context on an expense: "Mara's birthday", "includes the deposit", "split before
-- Sam arrived". Nullable with no default, so nothing is invented for the rows that already exist.
ALTER TABLE `expenses` ADD `note` text;
