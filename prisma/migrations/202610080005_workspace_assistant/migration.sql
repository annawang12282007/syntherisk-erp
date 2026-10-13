ALTER TABLE file_assistant_runs DROP CONSTRAINT file_assistant_runs_mode_check;
ALTER TABLE file_assistant_runs ADD CHECK(mode IN ('contacts','receipts','notes','workspace','personal'));
ALTER TABLE file_assistant_runs ADD COLUMN locale text NOT NULL DEFAULT 'zh-CN';
CREATE TABLE assistant_operation_results(
 run_id uuid NOT NULL REFERENCES file_assistant_runs(id),step_id text NOT NULL,status text NOT NULL CHECK(status IN ('completed','failed')),
 result jsonb,error_code text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,step_id)
);
CREATE TABLE assistant_personal_settings(
 workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),
 daily_enabled boolean NOT NULL DEFAULT false,report_time text NOT NULL DEFAULT '09:00',timezone text NOT NULL DEFAULT 'America/Los_Angeles',
 topics text[] NOT NULL DEFAULT ARRAY['tasks','requests','handoffs','reviews','events'],
 instruction text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id),CHECK(report_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
CREATE TABLE assistant_daily_reports(
 workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),local_date date NOT NULL,
 run_id uuid REFERENCES file_assistant_runs(id),status text NOT NULL DEFAULT 'queued',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id,local_date)
);
