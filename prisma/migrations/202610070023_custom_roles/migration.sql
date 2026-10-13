CREATE TABLE workspace_roles (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 code text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL REFERENCES "user"(id),
 updated_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,code), UNIQUE(workspace_id,name)
);
ALTER TABLE permissions DROP CONSTRAINT permissions_role_code_fkey;
ALTER TABLE permissions DROP CONSTRAINT permissions_scope_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_scope_check CHECK(
 scope IN ('all','none') OR (string_to_array(scope,',') <@ ARRAY['own','created','responsible','assigned','granted']::text[] AND length(scope)>0)
);
ALTER TABLE memberships DROP CONSTRAINT memberships_roles_check;
CREATE FUNCTION valid_workspace_roles(w uuid,codes text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT cardinality(codes)>0 AND NOT EXISTS (
  SELECT 1 FROM unnest(codes) AS requested(code) WHERE requested.code NOT IN ('admin','operations','finance','reviewer','member','external')
  AND NOT EXISTS(SELECT 1 FROM workspace_roles r WHERE r.workspace_id=w AND r.code=requested.code AND r.active)
 );
$$;
CREATE FUNCTION enforce_workspace_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT valid_workspace_roles(NEW.workspace_id,NEW.roles) THEN RAISE EXCEPTION 'Invalid workspace roles' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER membership_roles_guard BEFORE INSERT OR UPDATE OF roles ON memberships FOR EACH ROW EXECUTE FUNCTION enforce_workspace_roles();
CREATE TRIGGER invitation_roles_guard BEFORE INSERT OR UPDATE OF roles ON invitations FOR EACH ROW EXECUTE FUNCTION enforce_workspace_roles();
