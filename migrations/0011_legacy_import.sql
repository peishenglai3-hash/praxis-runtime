-- Phase 5 Legacy migration record.
--
-- The event ledger remains authoritative: every imported signal, pattern, graph
-- edge and anomaly is an append-first `legacy.*` event. The tables here record
-- the *run*: which corpus was read, what the inventory was, and which anomalies
-- were found. They are audit material, not a second source of truth.
--
-- A run row and its events commit in one transaction. A crash therefore leaves
-- either the whole run or none of it, and a re-import of the same corpus is
-- recognised by `(source_fingerprint, plan_hash)` rather than by re-deriving it.
--
-- These tables deliberately carry no first-generation record values. They hold
-- file metadata (path, size, digest, parse status), anomaly classes, counts and
-- bounding strings. The record values live in the events, where the existing
-- privacy-purge path can reach them.

CREATE TABLE IF NOT EXISTS legacy_import_runs (
  run_id TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  root TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'already-imported')),
  counts_json TEXT NOT NULL,
  anomaly_summary_json TEXT NOT NULL,
  archive_manifest_json TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_import_runs_identity
  ON legacy_import_runs(source_fingerprint, plan_hash);

CREATE INDEX IF NOT EXISTS idx_legacy_import_runs_completed
  ON legacy_import_runs(completed_at DESC);

CREATE TABLE IF NOT EXISTS legacy_source_inventory (
  run_id TEXT NOT NULL REFERENCES legacy_import_runs(run_id),
  relative_path TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  modified_at INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN
    ('parsed', 'partially_parsed', 'failed', 'skipped')),
  anomaly_classes_json TEXT NOT NULL,
  PRIMARY KEY (run_id, relative_path)
);

CREATE TABLE IF NOT EXISTS legacy_anomalies (
  run_id TEXT NOT NULL REFERENCES legacy_import_runs(run_id),
  anomaly_id TEXT NOT NULL,
  anomaly_class TEXT NOT NULL CHECK (anomaly_class IN
    ('possible_overwrite', 'ambiguous_pattern', 'source_metadata_conflict',
     'unrecoverable_field', 'cartesian_relation', 'parse_error',
     'encoding_marker', 'unmapped_path', 'privacy_sensitive')),
  reason TEXT NOT NULL,
  relative_path TEXT,
  artifact_kind TEXT,
  affected_count INTEGER NOT NULL CHECK (affected_count > 0),
  declared_value TEXT,
  PRIMARY KEY (run_id, anomaly_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_anomalies_class
  ON legacy_anomalies(anomaly_class, run_id);

-- Low-level structural guard for the `legacy.*` family. The runtime is the
-- semantic boundary; this trigger stops a caller that reaches the generic
-- EventWriter surface directly from recording an import without the
-- provenance, deterministic identity and corpus fingerprint that make it
-- auditable. It is narrower than an authorization system by design.
DROP TRIGGER IF EXISTS legacy_event_integrity;
CREATE TRIGGER legacy_event_integrity
BEFORE INSERT ON events
WHEN NEW.type LIKE 'legacy.%'
BEGIN
  SELECT RAISE(ABORT, 'legacy events require an importer or owner writer')
  WHERE COALESCE(json_extract(NEW.writer_json, '$.role'), '') NOT IN
        ('IMPORTER', 'OWNER');

  SELECT RAISE(ABORT, 'legacy event payload must be a canonical object')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR LENGTH(COALESCE(json_extract(NEW.payload_json, '$.sourceFingerprint'), '')) <> 64
     OR COALESCE(NEW.operation_id, '') = ''
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1
     OR json_extract(NEW.source_json, '$.ref') IS NULL
     OR json_extract(NEW.source_json, '$.ref') <> json_extract(NEW.payload_json, '$.sourceFingerprint');

  -- Provenance is fixed per event type; a caller cannot choose it.
  SELECT RAISE(ABORT, 'legacy event provenance does not match its family')
  WHERE (NEW.type = 'legacy.signal.imported'
         AND COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'declared')
     OR (NEW.type IN ('legacy.pattern.imported', 'legacy.graph-edge.imported')
         AND COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred')
     OR (NEW.type IN ('legacy.anomaly', 'legacy.import.completed')
         AND COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'direct');

  -- An unknown legacy verb is not a valid import record.
  SELECT RAISE(ABORT, 'unknown legacy event type')
  WHERE NEW.type NOT IN (
    'legacy.signal.imported',
    'legacy.pattern.imported',
    'legacy.graph-edge.imported',
    'legacy.anomaly',
    'legacy.import.completed'
  );
END;

-- Import records are history: corrections are new runs, not edits.
DROP TRIGGER IF EXISTS legacy_import_immutable;
CREATE TRIGGER legacy_import_immutable
BEFORE UPDATE ON legacy_import_runs
BEGIN
  SELECT RAISE(ABORT, 'legacy import runs are append-only');
END;

DROP TRIGGER IF EXISTS legacy_import_no_delete;
CREATE TRIGGER legacy_import_no_delete
BEFORE DELETE ON legacy_import_runs
BEGIN
  SELECT RAISE(ABORT, 'legacy import runs are append-only');
END;

DROP TRIGGER IF EXISTS legacy_inventory_immutable;
CREATE TRIGGER legacy_inventory_immutable
BEFORE UPDATE ON legacy_source_inventory
BEGIN
  SELECT RAISE(ABORT, 'legacy source inventory is append-only');
END;

DROP TRIGGER IF EXISTS legacy_inventory_no_delete;
CREATE TRIGGER legacy_inventory_no_delete
BEFORE DELETE ON legacy_source_inventory
BEGIN
  SELECT RAISE(ABORT, 'legacy source inventory is append-only');
END;

DROP TRIGGER IF EXISTS legacy_anomaly_immutable;
CREATE TRIGGER legacy_anomaly_immutable
BEFORE UPDATE ON legacy_anomalies
BEGIN
  SELECT RAISE(ABORT, 'legacy anomalies are append-only');
END;

DROP TRIGGER IF EXISTS legacy_anomaly_no_delete;
CREATE TRIGGER legacy_anomaly_no_delete
BEFORE DELETE ON legacy_anomalies
BEGIN
  SELECT RAISE(ABORT, 'legacy anomalies are append-only');
END;
