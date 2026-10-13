-- message_id is already globally unique. This explicit composite key also
-- describes the workspace-safe one-to-one relation to Prisma introspection.
ALTER TABLE deliveries ADD CONSTRAINT deliveries_message_workspace_key UNIQUE (message_id,workspace_id);
