DO $$ DECLARE resource text; BEGIN
 FOREACH resource IN ARRAY ARRAY['activities','engagements','tasks','work_requests','events','expense_claims','expense_lines','approval_policies','customer_quotes','customer_invoices','vendor_bills','budgets','journal_lines','purchase_requests','purchase_orders','subscriptions','documents','contracts','license_records','meetings','decisions','interviews','feedback','trials','validation_records','product_issues'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN reference_notes jsonb NOT NULL DEFAULT ''{}''::jsonb CHECK(jsonb_typeof(reference_notes)=''object'')',resource);
 END LOOP;
END $$;
