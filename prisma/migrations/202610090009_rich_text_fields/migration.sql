ALTER TABLE external_item_comments DROP CONSTRAINT external_item_comments_body_check;
ALTER TABLE external_item_comments ADD CONSTRAINT external_item_comments_body_check CHECK(length(body) BETWEEN 1 AND 700000);
ALTER TABLE cloud_file_library DROP CONSTRAINT cloud_file_library_notes_check;
ALTER TABLE cloud_file_library ADD CONSTRAINT cloud_file_library_notes_check CHECK(length(notes)<=700000);
ALTER TABLE record_deletion_requests DROP CONSTRAINT record_deletion_requests_reason_check;
ALTER TABLE record_deletion_requests ADD CONSTRAINT record_deletion_requests_reason_check CHECK(length(reason) BETWEEN 1 AND 700000);
