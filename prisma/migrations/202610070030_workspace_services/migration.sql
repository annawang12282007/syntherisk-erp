ALTER TABLE integration_connections DROP CONSTRAINT IF EXISTS integration_connections_provider_check;
ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_provider_check CHECK(provider IN ('calendar','drive','meet','gmail','sheets','docs','forms','people'));
ALTER TABLE integration_connections ADD COLUMN granted_scopes text[] NOT NULL DEFAULT '{}', ADD COLUMN settings jsonb NOT NULL DEFAULT '{}', ADD COLUMN paused boolean NOT NULL DEFAULT false;
ALTER TABLE oauth_states ADD COLUMN requested_scopes text[] NOT NULL DEFAULT '{}';

-- Owner scoped staging. External content is never a company-wide record by default.
CREATE TABLE integration_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 connection_id uuid NOT NULL, user_id text NOT NULL REFERENCES "user"(id),
 kind text NOT NULL, external_id text NOT NULL, fingerprint text NOT NULL, data jsonb NOT NULL DEFAULT '{}',
 resource text, record_id uuid, state text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id),
 UNIQUE(connection_id,kind,external_id), UNIQUE(id,workspace_id)
);
CREATE TABLE integration_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),company_id uuid NOT NULL REFERENCES companies(id),
 user_id text NOT NULL REFERENCES "user"(id),connection_id uuid NOT NULL,kind text NOT NULL,
 input jsonb NOT NULL, preview jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','queued','running','succeeded','failed','uncertain','cancelled')),
 result jsonb,last_error text,expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id), UNIQUE(id,workspace_id)
);
CREATE INDEX integration_operations_owner ON integration_operations(workspace_id,user_id,created_at DESC);
CREATE TABLE google_mail_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),connection_id uuid NOT NULL,
 user_id text NOT NULL REFERENCES "user"(id),from_address text NOT NULL,to_addresses text[] NOT NULL DEFAULT '{}',cc_addresses text[] NOT NULL DEFAULT '{}',
 subject text NOT NULL DEFAULT '',body text NOT NULL DEFAULT '',attachments jsonb NOT NULL DEFAULT '[]',
 remote_draft_id text,remote_message_id text,version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'draft',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(connection_id,workspace_id) REFERENCES integration_connections(id,workspace_id)
);
CREATE TABLE chat_destinations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),owner_id text NOT NULL REFERENCES "user"(id),
 name text NOT NULL,space_name text NOT NULL,webhook_encrypted text NOT NULL,recipient_ids text[] NOT NULL,
 kinds text[] NOT NULL DEFAULT '{}',enabled boolean NOT NULL DEFAULT false,last_success_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,workspace_id)
);
CREATE TABLE chat_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),destination_id uuid NOT NULL,
 dedupe_key text NOT NULL,status text NOT NULL DEFAULT 'pending',message_name text,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(destination_id,workspace_id) REFERENCES chat_destinations(id,workspace_id),
 UNIQUE(destination_id,dedupe_key)
);
