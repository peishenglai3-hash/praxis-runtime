-- Enforce the v1 event contract for records created after the original
-- bootstrap. Existing rows must already have explicit provenance; a null
-- provenance value aborts this migration instead of being silently inferred.

CREATE TABLE events_contract (
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
  provenance_json TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

INSERT INTO events_contract (
  seq, id, schema_version, event_version, type,
  occurred_at, observed_at, recorded_at,
  actor_type, actor_id, session_id, trace_id, operation_id,
  source_json, payload_json, evidence_json, links_json,
  provenance_json, content_hash
)
SELECT
  seq, id, schema_version, event_version, type,
  occurred_at, observed_at, recorded_at,
  actor_type, actor_id, session_id, trace_id, operation_id,
  source_json, payload_json, evidence_json, links_json,
  provenance_json, content_hash
FROM events;

DROP TABLE events;
ALTER TABLE events_contract RENAME TO events;

CREATE UNIQUE INDEX idx_events_operation_type_unique
  ON events(operation_id, type)
  WHERE operation_id IS NOT NULL;

CREATE INDEX idx_events_type_seq ON events(type, seq);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);
CREATE INDEX idx_events_trace_seq ON events(trace_id, seq);
CREATE INDEX idx_events_actor_seq ON events(actor_type, actor_id, seq);
