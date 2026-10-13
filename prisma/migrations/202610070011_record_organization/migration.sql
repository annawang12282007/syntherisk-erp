CREATE TABLE record_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 created_by text NOT NULL REFERENCES "user"(id),
 updated_by text NOT NULL REFERENCES "user"(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX record_category_active_name ON record_categories(workspace_id,lower(name)) WHERE NOT archived;
CREATE TABLE record_category_links (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 category_id uuid NOT NULL,
 created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,resource,record_id,category_id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 FOREIGN KEY(workspace_id,category_id) REFERENCES record_categories(workspace_id,id)
);
CREATE INDEX record_category_filter ON record_category_links(workspace_id,company_id,resource,category_id,record_id);
CREATE TABLE record_project_links (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 project_id uuid NOT NULL,
 created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,resource,record_id,project_id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
);
CREATE INDEX record_project_filter ON record_project_links(workspace_id,company_id,resource,project_id,record_id);
