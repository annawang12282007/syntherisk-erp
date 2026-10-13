CREATE TABLE account_security (
 user_id text PRIMARY KEY REFERENCES "user"(id),must_change_password boolean NOT NULL DEFAULT false,
 password_changed_at timestamptz,provisioned_by text REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now()
);
