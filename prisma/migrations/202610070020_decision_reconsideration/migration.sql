ALTER TABLE decisions ADD COLUMN reconsideration_of uuid, ADD COLUMN reconsideration_reason text;
ALTER TABLE decisions ADD CONSTRAINT decision_reconsideration_source FOREIGN KEY(reconsideration_of,workspace_id) REFERENCES decisions(id,workspace_id);
CREATE INDEX decisions_reconsideration_idx ON decisions(workspace_id,company_id,reconsideration_of) WHERE reconsideration_of IS NOT NULL;
