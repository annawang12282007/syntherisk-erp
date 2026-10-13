CREATE TABLE record_confirmation_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL REFERENCES companies(id),
 resource text NOT NULL, record_id uuid NOT NULL, record_version integer NOT NULL,
 action text NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), actor_name text NOT NULL,
 body text NOT NULL CHECK(length(btrim(body))>0),
 format text NOT NULL DEFAULT 'plain' CHECK(format IN ('plain','rich')),
 target_resource text, target_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((target_resource IS NULL)=(target_id IS NULL)),
 CONSTRAINT record_confirmation_notes_event_unique UNIQUE(workspace_id,resource,record_id,record_version,action,actor_id)
);
CREATE INDEX record_confirmation_notes_record ON record_confirmation_notes(workspace_id,company_id,resource,record_id,created_at);
CREATE INDEX record_confirmation_notes_target ON record_confirmation_notes(workspace_id,company_id,target_resource,target_id,created_at) WHERE target_id IS NOT NULL;

