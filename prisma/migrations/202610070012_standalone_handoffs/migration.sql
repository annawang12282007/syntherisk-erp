-- A handoff may record a standalone responsibility without linking an existing task.
ALTER TABLE handoffs ALTER COLUMN task_id DROP NOT NULL;
