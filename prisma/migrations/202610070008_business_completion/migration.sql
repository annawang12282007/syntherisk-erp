CREATE TABLE engagement_collaborators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),company_id uuid NOT NULL REFERENCES companies(id),
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),owner_id text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),archived boolean NOT NULL DEFAULT false,
 engagement_id uuid NOT NULL,user_id text NOT NULL REFERENCES "user"(id),responsibility text,notes text,
 UNIQUE(workspace_id,id),UNIQUE(id,workspace_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id)
);
CREATE UNIQUE INDEX engagement_collaborators_unique ON engagement_collaborators(workspace_id,engagement_id,user_id) WHERE NOT archived;
CREATE INDEX engagement_collaborators_owner ON engagement_collaborators(workspace_id,owner_id);
ALTER TABLE subscriptions ADD COLUMN category_id uuid,ADD CONSTRAINT subscription_category_fk FOREIGN KEY(workspace_id,category_id) REFERENCES expense_categories(workspace_id,id);
