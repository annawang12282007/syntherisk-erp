CREATE TABLE record_responsibles (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 user_id text NOT NULL REFERENCES "user"(id),
 created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,resource,record_id,user_id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE INDEX record_responsible_user ON record_responsibles(workspace_id,company_id,user_id,resource,record_id);
-- Ordinary responsibility can be unassigned. The financial claimant stays mandatory.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT c.table_name FROM information_schema.columns c
 JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
 WHERE c.table_schema=current_schema() AND c.column_name='owner_id' AND c.is_nullable='NO'
 AND c.table_name<>'expense_claims' AND t.table_type='BASE TABLE'
 LOOP EXECUTE format('ALTER TABLE %I ALTER COLUMN owner_id DROP NOT NULL',item.table_name); END LOOP;
END $$;
