-- Keep legacy 'team' audiences company-wide; only explicit selections narrow them.
DO $$ DECLARE resource text; BEGIN
 FOREACH resource IN ARRAY ARRAY['organizations','contacts','activities','engagements','projects','tasks','events','documents','contracts','license_records','meetings','decisions','interviews','feedback','trials','validation_records','product_issues'] LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I, ADD COLUMN viewer_team_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], ADD CONSTRAINT %I CHECK(visibility IN(''team'',''restricted'',''selected_teams'')), ADD CONSTRAINT %I CHECK(cardinality(viewer_team_ids)<=50 AND (visibility<>''selected_teams'' OR is_private OR cardinality(viewer_team_ids)>0))',resource,resource||'_visibility_check',resource||'_visibility_check',resource||'_team_audience_check');
  EXECUTE format('DROP TRIGGER delegation_visibility_revision ON %I',resource);
  EXECUTE format('CREATE TRIGGER delegation_visibility_revision AFTER UPDATE OF visibility,viewer_user_ids,viewer_team_ids,is_private ON %I FOR EACH ROW WHEN(OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.viewer_user_ids IS DISTINCT FROM NEW.viewer_user_ids OR OLD.viewer_team_ids IS DISTINCT FROM NEW.viewer_team_ids OR OLD.is_private IS DISTINCT FROM NEW.is_private) EXECUTE FUNCTION invalidate_target_delegations()',resource);
 END LOOP;
END $$;
-- A former team member must not keep a delegation based on their old audience.
CREATE TRIGGER delegation_team_membership_revision AFTER INSERT OR DELETE ON company_team_members FOR EACH ROW EXECUTE FUNCTION invalidate_scoped_delegations();
CREATE TRIGGER delegation_team_membership_update_revision AFTER UPDATE ON company_team_members FOR EACH ROW WHEN(OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.user_id IS DISTINCT FROM NEW.user_id) EXECUTE FUNCTION invalidate_scoped_delegations();
