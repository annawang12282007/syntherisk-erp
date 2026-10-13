ALTER TABLE announcements ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE announcements ADD COLUMN archived_at timestamptz;
CREATE INDEX announcement_archive_lookup ON announcements(workspace_id,company_id,archived,created_at DESC);
