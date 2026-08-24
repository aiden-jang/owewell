-- Back to dollars only. A per-group currency relabelled amounts rather than converting them, which
-- is the honest behaviour but a narrow one: it earns its keep on a trip abroad and costs a concept
-- everywhere else. No production group had ever been set to anything but USD.
--
-- The formatting layer stays. What goes is the column, the picker and the endpoint behind it.
ALTER TABLE `groups` DROP COLUMN `currency`;
