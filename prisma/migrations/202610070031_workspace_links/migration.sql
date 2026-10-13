CREATE TABLE integration_item_links (
 item_id uuid NOT NULL, workspace_id uuid NOT NULL, resource text NOT NULL, record_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN ('import','link')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id,resource,record_id),
 FOREIGN KEY(item_id,workspace_id) REFERENCES integration_items(id,workspace_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX integration_item_import_once ON integration_item_links(item_id,resource) WHERE origin='import';
INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin)
 SELECT id,workspace_id,resource,record_id,CASE WHEN state='imported' THEN 'import' ELSE 'link' END
 FROM integration_items WHERE resource IS NOT NULL AND record_id IS NOT NULL;
CREATE INDEX integration_item_links_record ON integration_item_links(workspace_id,resource,record_id);
