-- Explicitly shared mail attachments are private ERP snapshots, never public URLs.
CREATE TABLE shared_mail_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL REFERENCES shared_external_items(id) ON DELETE CASCADE,
 source_key text NOT NULL, filename text NOT NULL,mime_type text NOT NULL,content bytea NOT NULL,
 sha256 text NOT NULL,byte_size integer NOT NULL CHECK(byte_size BETWEEN 0 AND 5000000),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(item_id,source_key)
);
CREATE TABLE mail_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),owner_id text NOT NULL REFERENCES "user"(id),filename text NOT NULL,content bytea NOT NULL,mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),sha256 text NOT NULL,archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE departments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL,prefix varchar(4) NOT NULL CHECK(prefix ~ '^[A-Z]{1,4}$'),description text NOT NULL DEFAULT '',permissions jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,UNIQUE(workspace_id,name));
CREATE TABLE department_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),department_id uuid NOT NULL REFERENCES departments(id),name text NOT NULL,prefix varchar(4) NOT NULL CHECK(prefix ~ '^[A-Z]{1,4}$'),permissions jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,UNIQUE(department_id,name));
CREATE TABLE employee_assignments(workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),job_id uuid NOT NULL REFERENCES department_jobs(id),PRIMARY KEY(workspace_id,user_id,job_id));
CREATE TABLE employee_numbers(workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),employee_number varchar(8) NOT NULL CHECK(employee_number ~ '^[A-Z]{1,4}[0-9]{4}$'),version integer NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,user_id),UNIQUE(workspace_id,employee_number));
CREATE TABLE employee_number_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),employee_number varchar(8) NOT NULL,actor_id text REFERENCES "user"(id),reason text NOT NULL DEFAULT 'initial allocation',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,employee_number));
CREATE TABLE operator_configuration(workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),name text NOT NULL DEFAULT '統合運營者',permissions jsonb NOT NULL DEFAULT '[{"resource":"*","operation":"read","scope":"all"},{"resource":"*","operation":"create","scope":"all"},{"resource":"*","operation":"edit","scope":"all"},{"resource":"*","operation":"export","scope":"all"},{"resource":"team_private","operation":"read","scope":"none"},{"resource":"team_private","operation":"edit","scope":"none"}]',version integer NOT NULL DEFAULT 1);
ALTER TABLE memberships ADD COLUMN onboarding_jobs uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE invitations ADD COLUMN onboarding_jobs uuid[] NOT NULL DEFAULT '{}';
CREATE FUNCTION initialize_departments(w uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid; label text; p text;
BEGIN
 INSERT INTO operator_configuration(workspace_id) VALUES(w) ON CONFLICT DO NOTHING;
 FOR label,p IN SELECT * FROM (VALUES('IT部門','IT'),('財務部門','FIN'),('運營部門','OPS')) AS defaults(name,prefix) LOOP
  INSERT INTO departments(workspace_id,name,prefix,description,permissions) VALUES(w,label,p,'可編輯的初始部門','[{"resource":"team_directory","operation":"read","scope":"all"}]') ON CONFLICT(workspace_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO d;
  INSERT INTO department_jobs(department_id,name,prefix,permissions) VALUES(d,'一般員工',p,'[{"resource":"team_directory","operation":"edit","scope":"own"}]'),(d,'部門主管',p,'[{"resource":"team_directory","operation":"edit","scope":"own"},{"resource":"communication_templates","operation":"create","scope":"all"},{"resource":"communication_templates","operation":"edit","scope":"all"}]') ON CONFLICT DO NOTHING;
  IF p='FIN' THEN INSERT INTO department_jobs(department_id,name,prefix,permissions) VALUES(d,'財務管理員',p,'[{"resource":"finance_management","operation":"operate","scope":"all"}]') ON CONFLICT DO NOTHING; END IF;
 END LOOP;
END $$;
SELECT initialize_departments(id) FROM workspaces;
CREATE FUNCTION initialize_workspace_departments() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM initialize_departments(NEW.id);RETURN NEW;END $$;
CREATE TRIGGER workspace_departments AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION initialize_workspace_departments();
CREATE FUNCTION allocate_employee_number(w uuid,u text,p text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n text; num integer;
BEGIN
 SELECT employee_number INTO n FROM employee_numbers WHERE workspace_id=w AND user_id=u;IF n IS NOT NULL THEN RETURN n;END IF;
 IF p !~ '^[A-Z]{1,4}$' THEN RAISE EXCEPTION 'Invalid employee prefix'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('employee-number:'||w::text));
 SELECT employee_number INTO n FROM employee_numbers WHERE workspace_id=w AND user_id=u;IF n IS NOT NULL THEN RETURN n;END IF;
 SELECT COALESCE(max(right(employee_number,4)::integer),0)+1 INTO num FROM employee_number_history WHERE workspace_id=w AND left(employee_number,length(employee_number)-4)=p;
 IF num>9999 THEN RAISE EXCEPTION 'Employee prefix exhausted' USING ERRCODE='23514'; END IF;n=p||lpad(num::text,4,'0');
 INSERT INTO employee_numbers(workspace_id,user_id,employee_number) VALUES(w,u,n);
 INSERT INTO employee_number_history(workspace_id,user_id,employee_number) VALUES(w,u,n);RETURN n;
END $$;
CREATE FUNCTION provision_employee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p text; valid_count integer;
BEGIN
 IF NEW.roles <@ ARRAY['external']::text[] THEN RETURN NEW;END IF;
 IF 'operations'=ANY(NEW.roles) AND cardinality(NEW.onboarding_jobs)>0 THEN RAISE EXCEPTION 'Operator cannot belong to department' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO valid_count FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE j.id=ANY(NEW.onboarding_jobs) AND d.workspace_id=NEW.workspace_id AND j.active AND d.active;
 IF valid_count<>cardinality(NEW.onboarding_jobs) THEN RAISE EXCEPTION 'Invalid onboarding jobs' USING ERRCODE='23514';END IF;
 SELECT j.prefix INTO p FROM department_jobs j WHERE j.id=NEW.onboarding_jobs[1];
 PERFORM allocate_employee_number(NEW.workspace_id,NEW.user_id,COALESCE(p,CASE WHEN 'operations'=ANY(NEW.roles) THEN 'OPS' WHEN 'admin'=ANY(NEW.roles) THEN 'SYS' ELSE 'GEN' END));
 INSERT INTO employee_assignments(workspace_id,user_id,job_id) SELECT NEW.workspace_id,NEW.user_id,unnest(NEW.onboarding_jobs) ON CONFLICT DO NOTHING;RETURN NEW;
END $$;
CREATE TRIGGER employee_registration AFTER INSERT ON memberships FOR EACH ROW EXECUTE FUNCTION provision_employee();
SELECT allocate_employee_number(workspace_id,user_id,CASE WHEN 'operations'=ANY(roles) THEN 'OPS' WHEN 'admin'=ANY(roles) THEN 'SYS' ELSE 'GEN' END) FROM memberships WHERE NOT(roles <@ ARRAY['external']::text[]) ORDER BY created_at,user_id;
CREATE FUNCTION effective_permissions(w uuid,u text,rs text[]) RETURNS TABLE(resource text,operation text,scope text) LANGUAGE sql STABLE AS $$
 SELECT p.resource,p.operation,p.scope FROM permissions p WHERE p.workspace_id=w AND p.role_code=ANY(rs)
 UNION ALL
 SELECT p->>'resource',p->>'operation',p->>'scope' FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id JOIN departments d ON d.id=j.department_id CROSS JOIN LATERAL jsonb_array_elements(j.permissions||d.permissions) p WHERE a.workspace_id=w AND a.user_id=u AND d.workspace_id=w AND d.active AND j.active AND NOT(rs <@ ARRAY['external']::text[])
 UNION ALL
 SELECT p->>'resource',p->>'operation',p->>'scope' FROM operator_configuration o CROSS JOIN LATERAL jsonb_array_elements(o.permissions) p WHERE o.workspace_id=w AND 'operations'=ANY(rs)
 UNION ALL
 SELECT p->>'resource',p->>'operation',p->>'scope' FROM department_jobs j JOIN departments d ON d.id=j.department_id CROSS JOIN LATERAL jsonb_array_elements(j.permissions||d.permissions) p WHERE d.workspace_id=w AND d.active AND j.active AND 'operations'=ANY(rs)
$$;
CREATE TABLE mail_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id text NOT NULL REFERENCES "user"(id),label text NOT NULL,display_name text NOT NULL,signature text NOT NULL DEFAULT '',version integer NOT NULL,active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,user_id,version));
CREATE UNIQUE INDEX mail_identity_active ON mail_identities(workspace_id,user_id) WHERE active;
ALTER TABLE google_mail_drafts ADD COLUMN from_name text NOT NULL DEFAULT '';
ALTER TABLE google_mail_drafts ADD COLUMN identity_id uuid;
CREATE FUNCTION clear_operator_assignments() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF 'operations'=ANY(NEW.roles) OR NEW.roles <@ ARRAY['external']::text[] THEN DELETE FROM employee_assignments WHERE workspace_id=NEW.workspace_id AND user_id=NEW.user_id;END IF;RETURN NEW;END $$;
CREATE TRIGGER operator_assignments AFTER UPDATE OF roles ON memberships FOR EACH ROW EXECUTE FUNCTION clear_operator_assignments();
ALTER TABLE mail_identities ADD COLUMN deleted_at timestamptz;
