ALTER TABLE groups ADD COLUMN ledger_version integer NOT NULL DEFAULT 0;

CREATE TRIGGER ledger_expense_insert AFTER INSERT ON expenses
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_expense_update AFTER UPDATE ON expenses
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_expense_delete AFTER DELETE ON expenses
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = OLD.group_id; END;

CREATE TRIGGER ledger_settlement_insert AFTER INSERT ON settlements
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_settlement_update AFTER UPDATE ON settlements
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_settlement_delete AFTER DELETE ON settlements
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = OLD.group_id; END;

CREATE TRIGGER ledger_member_insert AFTER INSERT ON group_members
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_member_update AFTER UPDATE OF person_id ON group_members
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = NEW.group_id; END;
CREATE TRIGGER ledger_member_delete AFTER DELETE ON group_members
BEGIN UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = OLD.group_id; END;

-- Member removal can reassign existing splits and item payers outside an expense update.
CREATE TRIGGER ledger_split_update AFTER UPDATE ON expense_splits
BEGIN
  UPDATE groups SET ledger_version = ledger_version + 1
  WHERE id = (SELECT group_id FROM expenses WHERE id = NEW.expense_id);
END;
CREATE TRIGGER ledger_split_delete AFTER DELETE ON expense_splits
BEGIN
  UPDATE groups SET ledger_version = ledger_version + 1
  WHERE id = (SELECT group_id FROM expenses WHERE id = OLD.expense_id);
END;
CREATE TRIGGER ledger_item_payer_update AFTER UPDATE OF payer_id ON expense_items
BEGIN
  UPDATE groups SET ledger_version = ledger_version + 1
  WHERE id = (SELECT group_id FROM expenses WHERE id = NEW.expense_id);
END;
