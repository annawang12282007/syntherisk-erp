ALTER TABLE workforce_payroll_periods ADD COLUMN context_start timestamptz, ADD COLUMN context_end timestamptz;
ALTER TABLE workforce_payroll_periods ADD CONSTRAINT workforce_context_bounds CHECK (context_start IS NULL OR context_end > context_start AND context_start <= range_start AND context_end >= range_end);
ALTER TABLE workforce_payroll_periods ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]';
CREATE OR REPLACE FUNCTION workforce_guard_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workforce_payroll_periods' THEN
  IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved payroll is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM workforce_payroll_periods WHERE id IN(NEW.period_id,OLD.period_id) AND status='approved') THEN RAISE EXCEPTION 'Approved payroll items are immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;$$;
