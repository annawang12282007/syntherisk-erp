CREATE TABLE workforce_settings (
 workspace_id uuid NOT NULL,company_id uuid NOT NULL,policy jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,company_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE TABLE workforce_workers (
 workspace_id uuid NOT NULL,company_id uuid NOT NULL,user_id text NOT NULL,active boolean NOT NULL DEFAULT true,
 start_date date NOT NULL,end_date date,version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,company_id,user_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id),CHECK(end_date IS NULL OR end_date>=start_date)
);
CREATE TABLE workforce_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,user_id text NOT NULL,
 title text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,
 unpaid_break_minutes integer NOT NULL DEFAULT 0 CHECK(unpaid_break_minutes>=0),day_type text NOT NULL DEFAULT 'regular' CHECK(day_type IN('regular','rest','holiday')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','cancelled')),version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,company_id,id),FOREIGN KEY(workspace_id,company_id,user_id) REFERENCES workforce_workers(workspace_id,company_id,user_id),
 CHECK(end_at>start_at),CHECK(extract(epoch FROM end_at-start_at)>=unpaid_break_minutes*60)
);
CREATE INDEX workforce_shifts_range ON workforce_shifts(workspace_id,company_id,user_id,start_at,end_at);
CREATE TABLE workforce_attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,user_id text NOT NULL,shift_id uuid,
 clock_in_at timestamptz NOT NULL,clock_out_at timestamptz,break_started_at timestamptz,breaks jsonb NOT NULL DEFAULT '[]',
 unpaid_break_seconds integer NOT NULL DEFAULT 0 CHECK(unpaid_break_seconds>=0),day_type text NOT NULL DEFAULT 'regular' CHECK(day_type IN('regular','rest','holiday')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','voided')),version integer NOT NULL DEFAULT 1,
 correction_reason text,created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,company_id,id),FOREIGN KEY(workspace_id,company_id,user_id) REFERENCES workforce_workers(workspace_id,company_id,user_id),
 FOREIGN KEY(workspace_id,company_id,shift_id) REFERENCES workforce_shifts(workspace_id,company_id,id),
 CHECK(clock_out_at IS NULL OR clock_out_at>clock_in_at),CHECK(clock_out_at IS NULL OR break_started_at IS NULL),
 CHECK(clock_out_at IS NULL OR extract(epoch FROM clock_out_at-clock_in_at)>=unpaid_break_seconds),CHECK(status<>'approved' OR clock_out_at IS NOT NULL)
);
CREATE UNIQUE INDEX workforce_one_open_punch ON workforce_attendance(workspace_id,company_id,user_id) WHERE clock_out_at IS NULL AND status<>'voided';
CREATE INDEX workforce_attendance_range ON workforce_attendance(workspace_id,company_id,user_id,clock_in_at,clock_out_at);
CREATE TABLE workforce_clock_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,user_id text NOT NULL,attendance_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN('clock_in','break_start','break_end','clock_out')),server_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 idempotency_key text NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,
 UNIQUE(workspace_id,company_id,user_id,idempotency_key),FOREIGN KEY(workspace_id,company_id,attendance_id) REFERENCES workforce_attendance(workspace_id,company_id,id),
 FOREIGN KEY(workspace_id,company_id,user_id) REFERENCES workforce_workers(workspace_id,company_id,user_id)
);
CREATE TABLE workforce_pay_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,user_id text NOT NULL,
 effective_from date NOT NULL,basis text NOT NULL CHECK(basis IN('hourly','monthly')),amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 version integer NOT NULL DEFAULT 1,created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,company_id,user_id,effective_from),FOREIGN KEY(workspace_id,company_id,user_id) REFERENCES workforce_workers(workspace_id,company_id,user_id)
);
CREATE TABLE workforce_payroll_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,title text NOT NULL,
 start_date date NOT NULL,end_date_exclusive date NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','calculated','approved')),
 currency text NOT NULL DEFAULT 'TWD',gross_minor bigint,employee_count integer NOT NULL DEFAULT 0,version integer NOT NULL DEFAULT 1,
 settings_snapshot jsonb,input_hash text,range_start timestamptz,range_end timestamptz,calculated_at timestamptz,approved_at timestamptz,approved_by text REFERENCES "user"(id),
 created_by text NOT NULL REFERENCES "user"(id),updated_by text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,company_id,id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),CHECK(end_date_exclusive>start_date),
 CHECK(status<>'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND input_hash IS NOT NULL))
);
CREATE TABLE workforce_payroll_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,period_id uuid NOT NULL,user_id text NOT NULL,user_name text NOT NULL,
 regular_seconds integer NOT NULL,overtime_seconds integer NOT NULL,regular_pay_minor bigint NOT NULL,overtime_pay_minor bigint NOT NULL,gross_minor bigint NOT NULL,
 rate_segments jsonb NOT NULL,inputs jsonb NOT NULL,
 UNIQUE(period_id,user_id),FOREIGN KEY(workspace_id,company_id,period_id) REFERENCES workforce_payroll_periods(workspace_id,company_id,id),
 FOREIGN KEY(workspace_id,company_id,user_id) REFERENCES workforce_workers(workspace_id,company_id,user_id)
);
CREATE FUNCTION workforce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Approved payroll and raw clock events are immutable' USING ERRCODE='23514';END;$$;
CREATE TRIGGER workforce_clock_immutable BEFORE UPDATE OR DELETE ON workforce_clock_events FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
CREATE FUNCTION workforce_guard_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workforce_payroll_periods' THEN
  IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved payroll is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM workforce_payroll_periods WHERE id=COALESCE(NEW.period_id,OLD.period_id) AND status='approved') THEN RAISE EXCEPTION 'Approved payroll items are immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;$$;
CREATE TRIGGER workforce_period_immutable BEFORE UPDATE OR DELETE ON workforce_payroll_periods FOR EACH ROW EXECUTE FUNCTION workforce_guard_payroll();
CREATE TRIGGER workforce_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON workforce_payroll_items FOR EACH ROW EXECUTE FUNCTION workforce_guard_payroll();
CREATE TABLE workforce_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,company_id uuid NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),
 action text NOT NULL,record_id text NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id)
);
CREATE INDEX workforce_audit_record ON workforce_audit(workspace_id,company_id,record_id,created_at);
CREATE TRIGGER workforce_audit_immutable BEFORE UPDATE OR DELETE ON workforce_audit FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
