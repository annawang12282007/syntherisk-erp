ALTER TABLE attachments ADD CONSTRAINT attachments_id_workspace_unique UNIQUE(id,workspace_id);
CREATE TABLE signature_request_configurations (
 workspace_id uuid NOT NULL,
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 enabled boolean NOT NULL DEFAULT false,
 parties jsonb NOT NULL CHECK(jsonb_typeof(parties)='array'),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,company_id,resource,record_id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE TABLE signature_request_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 company_id uuid NOT NULL,
 resource text NOT NULL,
 record_id uuid NOT NULL,
 configuration_version integer NOT NULL,
 record_version integer NOT NULL,
 requested_by text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 canonical_snapshot text NOT NULL,
 UNIQUE(id,workspace_id,company_id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE TABLE signature_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 company_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('internal','external')),
 user_id text,
 signer_name text,
 external_name text,
 label text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','signed','cancelled','external_recorded')),
 cancelled_by text,
 cancelled_at timestamptz,
 cancellation_reason text,
 CHECK((kind='internal' AND user_id IS NOT NULL AND signer_name IS NOT NULL AND external_name IS NULL) OR (kind='external' AND user_id IS NULL AND signer_name IS NULL AND external_name IS NOT NULL)),
 UNIQUE(id,workspace_id,company_id),
 FOREIGN KEY(batch_id,workspace_id,company_id) REFERENCES signature_request_batches(id,workspace_id,company_id)
);
CREATE INDEX signature_requests_record ON signature_request_batches(workspace_id,company_id,resource,record_id,requested_at DESC);
CREATE INDEX signature_requests_inbox ON signature_requests(workspace_id,user_id,status);
CREATE TABLE signature_request_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 company_id uuid NOT NULL,
 request_id uuid NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN('internal','external')),
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 signed_at timestamptz NOT NULL,
 attachment_id uuid,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 canonical_payload text NOT NULL,
 FOREIGN KEY(request_id,workspace_id,company_id) REFERENCES signature_requests(id,workspace_id,company_id),
 FOREIGN KEY(attachment_id,workspace_id) REFERENCES attachments(id,workspace_id)
);
CREATE TRIGGER signature_request_batches_immutable BEFORE UPDATE OR DELETE ON signature_request_batches FOR EACH ROW EXECUTE FUNCTION electronic_signatures_immutable();
CREATE TRIGGER signature_request_receipts_immutable BEFORE UPDATE OR DELETE ON signature_request_receipts FOR EACH ROW EXECUTE FUNCTION electronic_signatures_immutable();
CREATE FUNCTION signature_request_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','cancelled_by','cancelled_at','cancellation_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancelled_by','cancelled_at','cancellation_reason']) OR OLD.status<>'pending' THEN
  RAISE EXCEPTION 'Signature request identity and completed states are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER signature_request_identity_guard BEFORE UPDATE ON signature_requests FOR EACH ROW EXECUTE FUNCTION signature_request_identity_immutable();
