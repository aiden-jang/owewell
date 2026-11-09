ALTER TABLE group_members ADD COLUMN add_client_id text;
CREATE UNIQUE INDEX gm_add_attempt ON group_members (group_id, add_client_id);

ALTER TABLE groups ADD COLUMN quick_split_draft_id text;
CREATE UNIQUE INDEX groups_quick_split_draft ON groups (created_by_id, quick_split_draft_id);
