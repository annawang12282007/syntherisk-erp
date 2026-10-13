CREATE TABLE signature_profiles (
 user_id text PRIMARY KEY REFERENCES "user"(id),mode text NOT NULL DEFAULT 'generated' CHECK(mode IN('generated','uploaded')),
 style text NOT NULL DEFAULT 'script' CHECK(style IN('script','serif','clean')),
 image_data bytea,image_sha256 text,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(mode<>'uploaded' OR (image_data IS NOT NULL AND image_sha256 IS NOT NULL)),CHECK(image_data IS NULL OR octet_length(image_data)<=1048576)
);
