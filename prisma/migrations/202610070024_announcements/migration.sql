CREATE TABLE announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),company_id uuid NOT NULL REFERENCES companies(id),
 title text NOT NULL,body text NOT NULL,category text NOT NULL DEFAULT 'general',priority text NOT NULL DEFAULT 'normal' CHECK(priority IN('normal','important','urgent')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','withdrawn')),require_ack boolean NOT NULL DEFAULT false,
 expires_at timestamptz,published_at timestamptz,withdrawal_reason text,
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1
);
CREATE TABLE announcement_recipients (
 announcement_id uuid NOT NULL REFERENCES announcements(id),user_id text NOT NULL REFERENCES "user"(id),
 viewed_at timestamptz,acknowledged_at timestamptz,PRIMARY KEY(announcement_id,user_id)
);
CREATE INDEX announcement_recipient_lookup ON announcement_recipients(user_id,announcement_id);
CREATE INDEX announcement_company_lookup ON announcements(workspace_id,company_id,created_at DESC);
