ALTER TABLE file_assistant_usage ADD COLUMN user_id text REFERENCES "user"(id);
UPDATE file_assistant_usage u SET user_id=r.user_id FROM file_assistant_runs r WHERE r.id=u.run_id;
ALTER TABLE file_assistant_usage ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE file_assistant_usage DROP CONSTRAINT file_assistant_usage_state_check;
ALTER TABLE file_assistant_usage ALTER COLUMN state SET DEFAULT 'pending';
UPDATE file_assistant_usage SET state='pending' WHERE state='reserved';
-- Keep the previous release insert-compatible for an application rollback.
ALTER TABLE file_assistant_usage ADD CHECK(state IN ('pending','reserved','settled','uncertain'));
CREATE FUNCTION assistant_usage_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id IS NULL THEN SELECT user_id INTO NEW.user_id FROM file_assistant_runs WHERE id=NEW.run_id AND workspace_id=NEW.workspace_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistant_usage_owner BEFORE INSERT ON file_assistant_usage FOR EACH ROW EXECUTE FUNCTION assistant_usage_owner();
ALTER TABLE file_assistant_usage ALTER COLUMN reserved_microusd SET DEFAULT 0;
CREATE INDEX file_assistant_user_month ON file_assistant_usage(workspace_id,user_id,month);
CREATE TABLE assistant_budget_policies (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),kind text NOT NULL CHECK(kind IN ('default','role','job','user')),
 subject text NOT NULL,limit_microusd bigint NOT NULL CHECK(limit_microusd BETWEEN 0 AND 1000000000),
 version integer NOT NULL DEFAULT 1,updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,kind,subject),CHECK(kind<>'default' OR subject='*')
);
CREATE TABLE assistant_budget_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),month text NOT NULL,
 requested_microusd bigint NOT NULL CHECK(requested_microusd BETWEEN 10000 AND 1000000000),reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),approved_microusd bigint CHECK(approved_microusd BETWEEN 0 AND 1000000000),
 reviewed_by text REFERENCES "user"(id),review_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz
);
CREATE UNIQUE INDEX assistant_budget_pending_request ON assistant_budget_requests(workspace_id,user_id,month) WHERE status='pending';
