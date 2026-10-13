ALTER TABLE tasks ADD COLUMN completion_required boolean NOT NULL DEFAULT false,
 ADD COLUMN completion_user_ids text[] NOT NULL DEFAULT '{}',
 ADD COLUMN completion_revision integer NOT NULL DEFAULT 1,
 ADD CONSTRAINT tasks_completion_recipients CHECK(cardinality(completion_user_ids)<=200 AND (NOT completion_required OR cardinality(completion_user_ids)>0));
CREATE TABLE task_completions (
 workspace_id uuid NOT NULL, task_id uuid NOT NULL, user_id text NOT NULL,
 revision integer NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,user_id,revision),
 FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
);
-- Old inbox items remain in-app; deployment must not email historical notices.
ALTER TABLE notifications ADD COLUMN email_status text NOT NULL DEFAULT 'legacy',
 ADD COLUMN email_error text, ADD COLUMN emailed_at timestamptz;
ALTER TABLE notifications ALTER COLUMN email_status SET DEFAULT 'pending';
ALTER TABLE notifications ADD CONSTRAINT notifications_email_status CHECK(email_status IN ('legacy','pending','sending','sent','skipped','failed','uncertain'));
CREATE INDEX notifications_email_pending ON notifications(created_at) WHERE email_status='pending';
