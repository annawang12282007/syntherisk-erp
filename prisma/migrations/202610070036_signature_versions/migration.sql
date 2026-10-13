ALTER TABLE signature_profiles ADD COLUMN signature_text text, ADD COLUMN label text NOT NULL DEFAULT 'Signature', ADD COLUMN saved_version integer;
CREATE TABLE signature_profile_versions (
 user_id text NOT NULL REFERENCES "user"(id), revision integer NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
 signature_text text NOT NULL CHECK(length(signature_text) BETWEEN 1 AND 120),
 mode text NOT NULL CHECK(mode IN('generated','uploaded')), style text NOT NULL CHECK(style IN('script','serif','clean')),
 image_data bytea,image_sha256 text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,revision), CHECK(mode<>'uploaded' OR (image_data IS NOT NULL AND image_sha256 IS NOT NULL)),
 CHECK(image_data IS NULL OR octet_length(image_data)<=1048576)
);
UPDATE signature_profiles p SET signature_text=left(u.name,120),saved_version=p.version FROM "user" u WHERE p.user_id=u.id;
INSERT INTO signature_profile_versions(user_id,revision,label,signature_text,mode,style,image_data,image_sha256,created_at)
 SELECT user_id,version,label,signature_text,mode,style,image_data,image_sha256,updated_at FROM signature_profiles;
CREATE FUNCTION protect_signature_profile_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Saved signature versions are immutable'; END $$;
CREATE TRIGGER signature_profile_version_immutable BEFORE UPDATE OR DELETE ON signature_profile_versions FOR EACH ROW EXECUTE FUNCTION protect_signature_profile_version();
