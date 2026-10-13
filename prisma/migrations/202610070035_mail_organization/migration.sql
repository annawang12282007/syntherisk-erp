CREATE TABLE personal_mail_organization (
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id),
  category text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(connection_id, external_id)
);
