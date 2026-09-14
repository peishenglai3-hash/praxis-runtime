-- Rebuildable projection and snapshot storage. These tables are derived data;
-- the events ledger remains the source of truth.

CREATE TABLE projection_state (
  projection_name TEXT PRIMARY KEY,
  projection_version INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projection_data (
  projection_name TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (projection_name, entity_key)
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  projection_name TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  cursor_seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_projection_data_name_seq
  ON projection_data(projection_name, last_seq);

CREATE INDEX idx_snapshots_projection_cursor
  ON snapshots(projection_name, projection_version, cursor_seq);
