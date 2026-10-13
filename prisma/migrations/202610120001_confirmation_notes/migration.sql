ALTER TABLE task_completions
 ADD COLUMN confirmation_note text,
 ADD CONSTRAINT task_completions_note_length CHECK(confirmation_note IS NULL OR char_length(confirmation_note)<=4000);
