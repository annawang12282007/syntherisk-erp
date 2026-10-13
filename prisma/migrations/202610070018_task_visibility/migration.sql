-- Creator-only privacy overlays (and never replaces) the managed audience.
DO $$ DECLARE resource text; BEGIN
 FOREACH resource IN ARRAY ARRAY['organizations','contacts','activities','engagements','projects','tasks','events','documents','contracts','license_records','meetings','decisions','interviews','feedback','trials','validation_records','product_issues'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN visibility text NOT NULL DEFAULT ''team'' CHECK(visibility IN(''team'',''restricted'')), ADD COLUMN viewer_user_ids text[] NOT NULL DEFAULT ARRAY[]::text[], ADD COLUMN is_private boolean NOT NULL DEFAULT false',resource);
  EXECUTE format('CREATE TRIGGER delegation_visibility_revision AFTER UPDATE OF visibility,viewer_user_ids,is_private ON %I FOR EACH ROW WHEN(OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.viewer_user_ids IS DISTINCT FROM NEW.viewer_user_ids OR OLD.is_private IS DISTINCT FROM NEW.is_private) EXECUTE FUNCTION invalidate_target_delegations()',resource);
 END LOOP;
END $$;
