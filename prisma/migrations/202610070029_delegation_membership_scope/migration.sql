-- Account changes only invalidate assignments involving that member.
-- Role policy changes still invalidate the workspace authority revision.
CREATE FUNCTION invalidate_member_delegations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_workspace uuid; member_user text;
BEGIN
 member_workspace=COALESCE(NEW.workspace_id,OLD.workspace_id);
 member_user=COALESCE(NEW.user_id,OLD.user_id);
 -- Serialize with delegated writes/reissue without changing unrelated grants.
 PERFORM id FROM workspaces WHERE id=member_workspace FOR UPDATE;
 UPDATE delegations SET authority_revision=0
 WHERE workspace_id=member_workspace AND (requester_id=member_user OR assignee_id=member_user)
 AND status NOT IN ('completed','revoked');
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER delegation_membership_revision ON memberships;
DROP TRIGGER delegation_membership_update_revision ON memberships;
CREATE TRIGGER delegation_membership_revision AFTER INSERT OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION invalidate_member_delegations();
CREATE TRIGGER delegation_membership_update_revision AFTER UPDATE ON memberships FOR EACH ROW WHEN(OLD.roles IS DISTINCT FROM NEW.roles OR OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION invalidate_member_delegations();
