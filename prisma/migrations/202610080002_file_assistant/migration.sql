CREATE TABLE file_assistant_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL, user_id text NOT NULL REFERENCES "user"(id), mode text NOT NULL CHECK(mode IN ('contacts','receipts','notes')),
 instruction text NOT NULL, supplement text NOT NULL DEFAULT '', targets jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','queued','analyzing','review','needs_input','completed','failed','cancelled')),
 attempt integer NOT NULL DEFAULT 0, plan jsonb, preview jsonb, fingerprint text, result jsonb,
 error_code text, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id), UNIQUE(id,workspace_id)
);
CREATE INDEX file_assistant_owner ON file_assistant_runs(workspace_id,user_id,created_at DESC);
CREATE TABLE file_assistant_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL, workspace_id uuid NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size>0), sha256 text NOT NULL,
 storage_key text UNIQUE NOT NULL, deleted_at timestamptz, purged_at timestamptz,
 FOREIGN KEY(run_id,workspace_id) REFERENCES file_assistant_runs(id,workspace_id)
);
CREATE TABLE file_assistant_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES file_assistant_runs(id),
 workspace_id uuid NOT NULL REFERENCES workspaces(id), attempt integer NOT NULL, month text NOT NULL,
 model text NOT NULL, reserved_microusd bigint NOT NULL CHECK(reserved_microusd>=0), actual_microusd bigint,
 input_tokens integer, output_tokens integer, state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,attempt), CHECK(actual_microusd IS NULL OR actual_microusd>=0)
);
CREATE INDEX file_assistant_month ON file_assistant_usage(month);
CREATE TABLE file_assistant_origins (
 workspace_id uuid NOT NULL, company_id uuid NOT NULL, fingerprint text NOT NULL,
 run_id uuid NOT NULL REFERENCES file_assistant_runs(id), resource text NOT NULL, record_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,company_id,fingerprint),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
