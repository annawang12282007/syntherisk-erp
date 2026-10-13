CREATE TABLE shared_external_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),company_id uuid NOT NULL REFERENCES companies(id),
 owner_id text NOT NULL REFERENCES "user"(id),source_item_id uuid NOT NULL REFERENCES integration_items(id),provider text NOT NULL,
 title text NOT NULL,snapshot jsonb NOT NULL,category text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,owner_id,source_item_id)
);
CREATE TABLE external_item_audience (
 item_id uuid NOT NULL REFERENCES shared_external_items(id) ON DELETE CASCADE,user_id text REFERENCES "user"(id),team_id uuid REFERENCES company_teams(id),
 can_comment boolean NOT NULL DEFAULT true,CHECK((user_id IS NULL)<>(team_id IS NULL))
);
CREATE UNIQUE INDEX external_audience_user ON external_item_audience(item_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX external_audience_team ON external_item_audience(item_id,team_id) WHERE team_id IS NOT NULL;
CREATE TABLE external_item_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL REFERENCES shared_external_items(id),author_id text NOT NULL REFERENCES "user"(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE external_item_versions (
 item_id uuid NOT NULL REFERENCES shared_external_items(id),version integer NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(item_id,version)
);
CREATE TABLE external_item_records (
 item_id uuid NOT NULL REFERENCES shared_external_items(id),resource text NOT NULL,record_id uuid NOT NULL,created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(item_id,resource,record_id)
);
CREATE TABLE personal_mail_preferences (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),signature text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,user_id)
);
ALTER TABLE google_mail_drafts ADD COLUMN reply_message_id text,ADD COLUMN reply_thread_id text,ADD COLUMN reply_rfc_id text;
