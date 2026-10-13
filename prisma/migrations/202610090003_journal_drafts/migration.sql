ALTER TABLE journal_entries ADD COLUMN draft_input jsonb;
ALTER TABLE journal_lines ADD COLUMN line_position integer NOT NULL DEFAULT 0;
CREATE TABLE journal_draft_requests (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL REFERENCES companies(id),
 user_id text NOT NULL REFERENCES "user"(id),
 request_id uuid NOT NULL,
 fingerprint text NOT NULL,
 entry_id uuid NOT NULL REFERENCES journal_entries(id),
 PRIMARY KEY(workspace_id,company_id,user_id,request_id)
);
