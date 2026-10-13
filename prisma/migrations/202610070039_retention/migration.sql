-- Saved appearances may be removed. Signed receipts contain independent snapshots.
DROP TRIGGER signature_profile_version_immutable ON signature_profile_versions;
CREATE TRIGGER signature_profile_version_immutable BEFORE UPDATE ON signature_profile_versions FOR EACH ROW EXECUTE FUNCTION protect_signature_profile_version();
ALTER TABLE cloud_file_library ADD COLUMN removed_at timestamptz;

CREATE TABLE retention_policies (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id),
 resource text NOT NULL, record_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 tier text NOT NULL CHECK(tier IN ('owner','authorized','approval','archive_only','locked')),
 version integer NOT NULL DEFAULT 1, updated_by text NOT NULL REFERENCES "user"(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,company_id,resource,record_id)
);
CREATE TABLE record_disposals (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id),
 resource text NOT NULL, record_id uuid NOT NULL,
 deleted_by text NOT NULL REFERENCES "user"(id), deleted_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,company_id,resource,record_id)
);
CREATE TABLE record_deletion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id),
 resource text NOT NULL, record_id uuid NOT NULL, record_version integer NOT NULL, policy_stamp text NOT NULL,
 requested_by text NOT NULL REFERENCES "user"(id), reviewer_id text NOT NULL REFERENCES "user"(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 review_reason text, CHECK(requested_by<>reviewer_id)
);
CREATE UNIQUE INDEX one_pending_record_deletion ON record_deletion_requests(workspace_id,company_id,resource,record_id) WHERE status='pending';
CREATE INDEX record_deletion_inbox ON record_deletion_requests(workspace_id,reviewer_id,status);

-- Enforce the non-archivable tier on internal archive paths too (e.g. merging).
CREATE FUNCTION protect_retention_archive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_tier text;
BEGIN
 IF NEW.archived IS DISTINCT FROM OLD.archived THEN
  SELECT tier INTO selected_tier FROM retention_policies
   WHERE workspace_id=NEW.workspace_id AND company_id=NEW.company_id
    AND resource=TG_TABLE_NAME AND record_id IN(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY (record_id=NEW.id) DESC LIMIT 1;
  IF selected_tier='locked' THEN RAISE EXCEPTION 'RETENTION_LOCKED' USING ERRCODE='P0004'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE target record;
BEGIN
 FOR target IN SELECT table_name FROM information_schema.columns WHERE table_schema='public'
  AND column_name IN('id','workspace_id','company_id','archived') GROUP BY table_name HAVING count(*)=4 LOOP
  EXECUTE format('CREATE TRIGGER retention_archive_guard BEFORE UPDATE OF archived ON %I FOR EACH ROW EXECUTE FUNCTION protect_retention_archive()',target.table_name);
 END LOOP;
END $$;
