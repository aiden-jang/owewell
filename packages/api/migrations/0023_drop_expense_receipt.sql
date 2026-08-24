-- Receipt photos and OCR scanning, removed.
--
-- They were never reachable in production: R2 has to be switched on for the whole Cloudflare account
-- before a bucket can exist, and `wrangler deploy` fails on a binding whose bucket does not, so the
-- binding stayed commented out and both flags stayed off. A feature behind a switch nobody can flip
-- is not a feature. Splitting a bill by line item stays; only the picture of it goes.
ALTER TABLE `expenses` DROP COLUMN `receipt_key`;
