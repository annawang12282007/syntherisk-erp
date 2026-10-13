ALTER TABLE workspaces ADD COLUMN access_revision bigint NOT NULL DEFAULT 1;
CREATE TABLE delegations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),company_id uuid NOT NULL,
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),owner_id text REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),archived boolean NOT NULL DEFAULT false,
 title text NOT NULL,notes text,instructions text,requester_id text NOT NULL REFERENCES "user"(id),assignee_id text NOT NULL REFERENCES "user"(id),
 target_resource text,target_id uuid,access_level text NOT NULL DEFAULT 'read' CHECK(access_level IN ('read','edit')),
 review_required boolean NOT NULL DEFAULT true,due_date date,expires_at timestamptz,authority_revision bigint NOT NULL,target_authority_revision bigint NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','in_progress','submitted','needs_changes','completed','revoked')),
 report text,review_comments text,submitted_target_version integer,submitted_snapshot jsonb,submitted_at timestamptz,completed_at timestamptz,revoked_at timestamptz,
 CHECK((target_resource IS NULL)=(target_id IS NULL)),CHECK(requester_id<>assignee_id),
 UNIQUE(id,workspace_id),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE INDEX delegation_access ON delegations(workspace_id,company_id,target_resource,target_id,assignee_id,status);
CREATE INDEX delegation_inbox ON delegations(workspace_id,company_id,assignee_id,updated_at DESC);
ALTER TABLE handoffs ADD COLUMN target_resource text,ADD COLUMN target_id uuid,ADD CONSTRAINT handoff_target_pair CHECK((target_resource IS NULL)=(target_id IS NULL));
ALTER TABLE work_requests ADD COLUMN target_resource text,ADD COLUMN target_id uuid,ADD CONSTRAINT work_request_target_pair CHECK((target_resource IS NULL)=(target_id IS NULL));
ALTER TABLE reviews ADD COLUMN target_resource text,ADD COLUMN target_id uuid,ADD COLUMN target_snapshot jsonb,ADD CONSTRAINT review_target_pair CHECK((target_resource IS NULL)=(target_id IS NULL));
CREATE FUNCTION invalidate_scoped_delegations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE workspaces SET access_revision=access_revision+1 WHERE id=COALESCE(NEW.workspace_id,OLD.workspace_id);RETURN COALESCE(NEW,OLD);END $$;
CREATE TRIGGER delegation_membership_revision AFTER INSERT OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_membership_update_revision AFTER UPDATE ON memberships FOR EACH ROW WHEN(OLD.roles IS DISTINCT FROM NEW.roles OR OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_policy_revision AFTER INSERT OR DELETE ON permissions FOR EACH ROW EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_policy_update_revision AFTER UPDATE ON permissions FOR EACH ROW WHEN(OLD.scope IS DISTINCT FROM NEW.scope) EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_grant_revision AFTER INSERT OR DELETE ON record_grants FOR EACH ROW EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_grant_update_revision AFTER UPDATE ON record_grants FOR EACH ROW WHEN(OLD.can_edit IS DISTINCT FROM NEW.can_edit) EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TABLE delegation_target_revisions(workspace_id uuid NOT NULL REFERENCES workspaces(id),resource text NOT NULL,record_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,resource,record_id));
CREATE FUNCTION invalidate_target_delegations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_table text;target_record uuid;target_workspace uuid;
BEGIN
 target_workspace=COALESCE(NEW.workspace_id,OLD.workspace_id);
 IF TG_TABLE_NAME='record_responsibles' THEN target_table=COALESCE(NEW.resource,OLD.resource);target_record=COALESCE(NEW.record_id,OLD.record_id);
 ELSIF TG_TABLE_NAME='task_collaborators' THEN target_table='tasks';target_record=COALESCE(NEW.task_id,OLD.task_id);
 ELSIF TG_TABLE_NAME='engagement_collaborators' THEN target_table='engagements';target_record=COALESCE(NEW.engagement_id,OLD.engagement_id);
 ELSE target_table=TG_TABLE_NAME;target_record=COALESCE(NEW.id,OLD.id);END IF;
 INSERT INTO delegation_target_revisions(workspace_id,resource,record_id) VALUES(target_workspace,target_table,target_record) ON CONFLICT(workspace_id,resource,record_id) DO UPDATE SET revision=delegation_target_revisions.revision+1;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER delegation_responsibility_revision AFTER INSERT OR UPDATE OR DELETE ON record_responsibles FOR EACH ROW EXECUTE FUNCTION invalidate_target_delegations();
CREATE TRIGGER delegation_task_collaborator_revision AFTER INSERT OR UPDATE OR DELETE ON task_collaborators FOR EACH ROW EXECUTE FUNCTION invalidate_target_delegations();
CREATE TRIGGER delegation_engagement_collaborator_revision AFTER INSERT OR UPDATE OR DELETE ON engagement_collaborators FOR EACH ROW EXECUTE FUNCTION invalidate_target_delegations();
DO $$ DECLARE item record;BEGIN
 FOR item IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema=current_schema() AND c.column_name='owner_id' AND t.table_type='BASE TABLE'
 LOOP EXECUTE format('CREATE TRIGGER delegation_owner_revision AFTER UPDATE OF owner_id ON %I FOR EACH ROW WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id) EXECUTE FUNCTION invalidate_target_delegations()',item.table_name);END LOOP;
END $$;
