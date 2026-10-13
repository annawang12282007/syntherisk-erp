-- Additional database-level invariants discovered by transactional workflow audit.
ALTER TABLE expense_claims ADD CONSTRAINT claim_balances CHECK(paid_minor<=approved_minor AND approved_minor<=total_minor);
ALTER TABLE vendor_bills ADD CONSTRAINT bill_balances CHECK(paid_minor+credit_minor<=total_minor);
ALTER TABLE customer_invoices ADD CONSTRAINT invoice_balances CHECK(paid_minor+credit_minor<=total_minor);
ALTER TABLE expense_lines ADD CONSTRAINT approved_line_limit CHECK(approved_minor IS NULL OR approved_minor<=amount_minor+tax_minor);
CREATE UNIQUE INDEX bank_reference_nullable_account_unique ON bank_transactions(workspace_id,company_id,COALESCE(bank_account,''),reference);
ALTER TABLE currencies ADD CONSTRAINT currency_digits_range CHECK(minor_digits BETWEEN 0 AND 6);
ALTER TABLE payments ADD COLUMN journal_entry_id uuid REFERENCES journal_entries(id), ADD COLUMN base_currency text, ADD COLUMN base_amount_minor numeric(20,0), ADD COLUMN base_exchange_rate numeric(24,12), ADD COLUMN base_exchange_rate_date date, ADD COLUMN base_exchange_rate_source text;
CREATE UNIQUE INDEX one_journal_per_payment ON payments(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE FUNCTION protect_fiscal_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='closed' AND (TG_OP='DELETE' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.status IS DISTINCT FROM OLD.status) THEN RAISE EXCEPTION 'closed_period_immutable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date) AND EXISTS(SELECT 1 FROM journal_entries j WHERE j.workspace_id=OLD.workspace_id AND j.company_id=OLD.company_id AND j.entry_date BETWEEN OLD.start_date AND OLD.end_date AND j.status IN ('posted','reversed')) THEN RAISE EXCEPTION 'posted_period_dates_immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER fiscal_period_guard BEFORE UPDATE OR DELETE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION protect_fiscal_period();
