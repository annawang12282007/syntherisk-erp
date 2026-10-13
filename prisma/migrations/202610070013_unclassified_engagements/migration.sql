ALTER TABLE engagements ALTER COLUMN pipeline_id DROP NOT NULL;
ALTER TABLE engagements ALTER COLUMN stage_id DROP NOT NULL;
ALTER TABLE engagements ADD CONSTRAINT engagement_pipeline_stage_pair
 CHECK ((pipeline_id IS NULL) = (stage_id IS NULL));
