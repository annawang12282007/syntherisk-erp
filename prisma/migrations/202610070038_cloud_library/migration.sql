CREATE TABLE cloud_file_library (
 item_id uuid PRIMARY KEY REFERENCES integration_items(id),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=20000),
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cloud_file_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES integration_items(id),
 actor_id text NOT NULL REFERENCES "user"(id),
 action text NOT NULL,
 data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cloud_file_history_item ON cloud_file_history(item_id,created_at DESC);
INSERT INTO cloud_file_library(item_id) SELECT id FROM integration_items WHERE kind IN ('drive_file','generated_doc','cloud_export') ON CONFLICT DO NOTHING;
