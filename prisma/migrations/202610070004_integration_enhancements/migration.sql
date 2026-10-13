ALTER TABLE messages ADD COLUMN template_id uuid;
ALTER TABLE messages ADD CONSTRAINT messages_template_fk FOREIGN KEY(template_id,workspace_id) REFERENCES communication_templates(id,workspace_id);
ALTER TABLE messages ADD CONSTRAINT messages_campaign_fk FOREIGN KEY(campaign_id,workspace_id) REFERENCES campaigns(id,workspace_id);
CREATE UNIQUE INDEX messages_campaign_contact_unique ON messages(workspace_id,campaign_id,contact_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX messages_workspace_created ON messages(workspace_id,created_at DESC);
CREATE INDEX drive_file_links_document ON drive_file_links(workspace_id,document_id);
