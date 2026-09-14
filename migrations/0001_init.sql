-- Phase 1 event substrate. Connection PRAGMAs are applied by SqliteEventStore
-- before this migration; this file contains schema changes only.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  event_version TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  session_id TEXT,
  trace_id TEXT,
  operation_id TEXT,
  source_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  evidence_json TEXT,
  links_json TEXT,
  provenance_json TEXT,
  content_hash TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_operation_id_unique
  ON events(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_type, actor_id);
