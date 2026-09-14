-- Allow one external operation to have one idempotent event per lifecycle type.
-- The same operationId may therefore be used by tool.requested,
-- tool.succeeded, and tool.failed without allowing duplicate retries of one
-- lifecycle event.

DROP INDEX IF EXISTS idx_events_operation_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_operation_type_unique
  ON events(operation_id, type)
  WHERE operation_id IS NOT NULL;
