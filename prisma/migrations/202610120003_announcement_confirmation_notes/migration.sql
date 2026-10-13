ALTER TABLE announcement_recipients
 ADD COLUMN confirmation_note text,
 ADD CONSTRAINT announcement_recipients_note_length CHECK(confirmation_note IS NULL OR char_length(confirmation_note)<=4000);
