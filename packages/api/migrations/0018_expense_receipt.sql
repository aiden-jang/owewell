-- Whether an expense has a receipt photo, and what its object is called. Nullable: most expenses
-- never get one. The key is derivable from the ids, but storing it means the scheme can change
-- without orphaning what is already in the bucket.
ALTER TABLE `expenses` ADD `receipt_key` text;
