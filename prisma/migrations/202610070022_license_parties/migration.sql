ALTER TABLE license_records ADD COLUMN grantor_name text, ADD COLUMN grantee_name text, ADD COLUMN contact_id uuid;
ALTER TABLE license_records ADD CONSTRAINT license_contact_workspace FOREIGN KEY(contact_id,workspace_id) REFERENCES contacts(id,workspace_id);
CREATE INDEX license_contact_idx ON license_records(workspace_id,company_id,contact_id) WHERE contact_id IS NOT NULL;
