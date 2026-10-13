CREATE TABLE electronic_signatures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 operation text NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 actor_roles jsonb NOT NULL CHECK(jsonb_typeof(actor_roles)='array'),
 typed_name text NOT NULL,
 consent_version text NOT NULL CHECK(consent_version='internal-confirmation-v1'),
 signed_at timestamptz NOT NULL,
 record_version integer NOT NULL CHECK(record_version>0),
 result_version integer NOT NULL CHECK(result_version>record_version),
 reviewed_hash text NOT NULL CHECK(reviewed_hash ~ '^[0-9a-f]{64}$'),
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 canonical_payload text NOT NULL,
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 UNIQUE(workspace_id,resource,record_id,operation,record_version)
);
CREATE INDEX electronic_signatures_record ON electronic_signatures(workspace_id,company_id,resource,record_id,signed_at DESC);
CREATE FUNCTION electronic_signatures_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Electronic signature receipts are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER electronic_signatures_no_update_delete BEFORE UPDATE OR DELETE ON electronic_signatures
FOR EACH ROW EXECUTE FUNCTION electronic_signatures_immutable();
