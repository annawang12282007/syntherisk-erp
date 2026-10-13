CREATE TABLE cloud_exports (
 operation_id uuid PRIMARY KEY REFERENCES integration_operations(id), document_id uuid NOT NULL REFERENCES documents(id),
 workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id text NOT NULL REFERENCES "user"(id),
 file_id text NOT NULL,format text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cloud_export_sources (
 document_id uuid NOT NULL REFERENCES documents(id),resource text NOT NULL,record_id uuid NOT NULL,version integer NOT NULL,
 PRIMARY KEY(document_id,resource,record_id)
);
CREATE INDEX cloud_export_source_lookup ON cloud_export_sources(resource,record_id);
