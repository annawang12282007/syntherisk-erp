CREATE TABLE integration_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('calendar','drive')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','syncing','failed','expired','disconnected')),
 tokens_encrypted text, calendar_id text, sync_direction text NOT NULL DEFAULT 'both' CHECK(sync_direction IN ('push','pull','both')),
 drive_id text, folder_id text, sync_token text, last_success_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,user_id,provider), UNIQUE(id,workspace_id)
);
CREATE TABLE oauth_states (
 state_hash text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id text NOT NULL, provider text NOT NULL,
 verifier_encrypted text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE external_event_mappings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL, event_id uuid NOT NULL,
 external_id text NOT NULL, etag text, local_version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'synced',
 external_snapshot jsonb, last_synced_at timestamptz, UNIQUE(connection_id,event_id), UNIQUE(connection_id,external_id),
 FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id),
 FOREIGN KEY(event_id,workspace_id) REFERENCES events(id,workspace_id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), kind text NOT NULL,
 payload jsonb NOT NULL, dedupe_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz, lease_token uuid,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(workspace_id,dedupe_key)
);
CREATE INDEX outbox_ready ON outbox(status,available_at,locked_until);
CREATE TABLE sync_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
 status text NOT NULL, records_processed integer NOT NULL DEFAULT 0, error_code text,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id)
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id text NOT NULL,
 kind text NOT NULL, title_key text NOT NULL, resource text NOT NULL, record_id uuid NOT NULL,
 dedupe_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 UNIQUE(workspace_id,user_id,dedupe_key)
);
CREATE INDEX notifications_inbox ON notifications(workspace_id,user_id,created_at DESC);
CREATE TABLE notification_preferences (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id text NOT NULL, kind text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, PRIMARY KEY(workspace_id,user_id,kind)
);
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id),
 created_by text NOT NULL, updated_by text NOT NULL, owner_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
 campaign_id uuid, contact_id uuid NOT NULL, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL, sender_account text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','queued','sent','failed','uncertain','cancelled')),
 reviewed_by text, reviewed_at timestamptz, confirmed_by text, confirmed_at timestamptz, sent_at timestamptz,
 UNIQUE(id,workspace_id), FOREIGN KEY(contact_id,workspace_id) REFERENCES contacts(id,workspace_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE TABLE deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, message_id uuid NOT NULL,
 company_id uuid NOT NULL REFERENCES companies(id),created_by text NOT NULL,updated_by text NOT NULL,owner_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,archived boolean NOT NULL DEFAULT false,
 provider text NOT NULL, provider_message_id text, status text NOT NULL CHECK(status IN ('pending','sending','sent','failed','uncertain')),
 attempt_count integer NOT NULL DEFAULT 0, error_code text, started_at timestamptz, delivered_at timestamptz,
 FOREIGN KEY(message_id,workspace_id) REFERENCES messages(id,workspace_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id), UNIQUE(message_id),UNIQUE(id,workspace_id)
);
CREATE TABLE drive_file_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL, document_id uuid,
 file_id text NOT NULL, name text NOT NULL, mime_type text NOT NULL, web_view_link text, modified_time timestamptz,
 can_download boolean NOT NULL DEFAULT false, can_edit boolean NOT NULL DEFAULT false, checked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,file_id), FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id),FOREIGN KEY(document_id,workspace_id) REFERENCES documents(id,workspace_id)
);
