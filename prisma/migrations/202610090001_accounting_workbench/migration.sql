ALTER TABLE payments ADD COLUMN payment_date date, ADD COLUMN bank_account_id uuid REFERENCES accounts(id);
ALTER TABLE bank_transactions ADD COLUMN bank_account_id uuid REFERENCES accounts(id);
CREATE TABLE accounting_profiles (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 version integer NOT NULL DEFAULT 1,
 tax_registration text NOT NULL DEFAULT 'unconfirmed' CHECK(tax_registration IN ('unconfirmed','registered','not_registered')),
 gst_hst_number text NOT NULL DEFAULT '',
 updated_by text NOT NULL REFERENCES "user"(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounting_postings (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid NOT NULL REFERENCES companies(id),
 resource text NOT NULL CHECK(resource IN ('expense_claims','vendor_bills','customer_invoices','payments')),
 record_id uuid NOT NULL,
 journal_entry_id uuid NOT NULL REFERENCES journal_entries(id),
 control_account_id uuid NOT NULL REFERENCES accounts(id),
 original_minor numeric(20,0) NOT NULL CHECK(original_minor>0),
 base_minor numeric(20,0) NOT NULL CHECK(base_minor>0),
 tax_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 plan jsonb NOT NULL,
 created_by text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,company_id,resource,record_id)
);
