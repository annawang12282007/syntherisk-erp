ALTER TABLE integration_connections ADD COLUMN google_email text, ADD COLUMN google_subject text, ADD COLUMN last_access_verified_at timestamptz;
