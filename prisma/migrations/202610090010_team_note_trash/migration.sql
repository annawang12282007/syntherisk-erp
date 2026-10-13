ALTER TABLE team_board_posts ADD COLUMN deleted_at timestamptz;
CREATE INDEX team_board_active_order ON team_board_posts(team_id,pinned DESC,updated_at DESC) WHERE deleted_at IS NULL;
