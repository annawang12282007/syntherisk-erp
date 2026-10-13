-- Explicit composite uniqueness for schema tooling; request_id is already unique.
ALTER TABLE signature_request_receipts ADD CONSTRAINT signature_receipts_request_workspace_company_key UNIQUE(request_id,workspace_id,company_id);
