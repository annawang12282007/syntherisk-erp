CREATE TABLE team_profiles (
 workspace_id uuid NOT NULL,
 user_id text NOT NULL,
 work_email text, personal_email text, work_phone text, mobile text, job_title text, contact_notes text,
 legal_name text, address text, birthday date, emergency_contact text, private_notes text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
);
