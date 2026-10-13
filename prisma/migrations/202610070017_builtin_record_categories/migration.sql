ALTER TABLE record_categories ADD COLUMN builtin_key text
 CHECK(builtin_key IS NULL OR builtin_key IN ('administration','finance','business','projects','product','legal','people'));
ALTER TABLE record_categories ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE record_categories ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE record_categories ADD CONSTRAINT record_category_creator CHECK(builtin_key IS NOT NULL OR (created_by IS NOT NULL AND updated_by IS NOT NULL));
DROP INDEX record_category_active_name;
CREATE UNIQUE INDEX record_category_active_name ON record_categories(workspace_id,lower(name)) WHERE NOT archived AND builtin_key IS NULL;
CREATE UNIQUE INDEX record_category_builtin_key ON record_categories(workspace_id,builtin_key) WHERE builtin_key IS NOT NULL;

CREATE FUNCTION ensure_builtin_record_categories(target_workspace uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO record_categories(workspace_id,name,builtin_key)
 SELECT target_workspace,item.name,item.key FROM (VALUES
 ('administration','行政'),('finance','財務'),('business','業務'),('projects','專案'),
 ('product','產品'),('legal','法務'),('people','人事')) AS item(key,name)
 ON CONFLICT(workspace_id,builtin_key) WHERE builtin_key IS NOT NULL DO NOTHING;
$$;
SELECT ensure_builtin_record_categories(workspace_id) FROM (SELECT DISTINCT workspace_id FROM companies) AS existing;

CREATE FUNCTION initialize_company_record_categories() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM ensure_builtin_record_categories(NEW.workspace_id); RETURN NEW; END;
$$;
CREATE TRIGGER company_record_categories AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION initialize_company_record_categories();

CREATE FUNCTION protect_builtin_record_categories() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.builtin_key IS NOT NULL THEN RAISE EXCEPTION 'builtin_category_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.builtin_key IS NOT NULL THEN RAISE EXCEPTION 'builtin_category_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER builtin_record_categories_immutable BEFORE UPDATE OR DELETE ON record_categories FOR EACH ROW EXECUTE FUNCTION protect_builtin_record_categories();
