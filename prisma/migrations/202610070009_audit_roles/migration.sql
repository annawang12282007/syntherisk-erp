-- Retain roles at the time of future events. Existing history is not backfilled.
ALTER TABLE audit_log ADD COLUMN actor_roles jsonb;
ALTER TABLE audit_log ADD CONSTRAINT audit_roles_array CHECK (actor_roles IS NULL OR jsonb_typeof(actor_roles) = 'array');
CREATE FUNCTION capture_audit_actor_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT to_jsonb(m.roles) INTO NEW.actor_roles
    FROM memberships m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.actor_id;
  ELSE
    NEW.actor_roles := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_actor_roles BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION capture_audit_actor_roles();
