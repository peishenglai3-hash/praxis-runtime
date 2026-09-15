-- Phase 3.5 maintenance boundaries. The event ledger remains authoritative;
-- purge receipts, managed-backup metadata, and allowed sequence gaps are
-- explicit audit material rather than hidden side effects.

CREATE TABLE IF NOT EXISTS privacy_purge_authorizations (
  token TEXT PRIMARY KEY,
  writer_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type = 'session'),
  scope_value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS purge_receipts (
  receipt_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type = 'session'),
  scope_value TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  writer_id TEXT NOT NULL,
  deleted_event_count INTEGER NOT NULL CHECK (deleted_event_count >= 0),
  deleted_seq_ranges_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  managed_backup_ids_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purged_seq_ranges (
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES purge_receipts(receipt_id),
  PRIMARY KEY (start_seq, end_seq),
  CHECK (start_seq > 0 AND end_seq >= start_seq)
);

CREATE TABLE IF NOT EXISTS managed_backups (
  backup_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  first_event_seq INTEGER NOT NULL CHECK (first_event_seq >= 0),
  last_event_seq INTEGER NOT NULL CHECK (last_event_seq >= 0),
  projection_versions_json TEXT NOT NULL,
  source_db_sha256 TEXT NOT NULL,
  backup_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'purge-pending', 'deleted')),
  pending_path TEXT,
  purged_at INTEGER
);

CREATE TABLE IF NOT EXISTS purge_asset_invalidations (
  asset_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES purge_receipts(receipt_id),
  invalidated_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  PRIMARY KEY (asset_id, receipt_id)
);

CREATE INDEX IF NOT EXISTS idx_purged_seq_ranges_end
  ON purged_seq_ranges(end_seq);

CREATE INDEX IF NOT EXISTS idx_managed_backups_status_seq
  ON managed_backups(status, last_event_seq);

CREATE TRIGGER phase35_expectation_contract_integrity
BEFORE INSERT ON events
WHEN NEW.type IN (
  'expectation.created',
  'expectation.updated',
  'expectation.cancelled',
  'expectation.status.changed',
  'verification.requested',
  'verification.completed'
)
BEGIN
  SELECT RAISE(ABORT, 'Phase 3.5 expectation lifecycle failed contract checks')
  WHERE COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'declared'
     OR COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'declared'
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1;

  SELECT RAISE(ABORT, 'expectation definition payload is malformed')
  WHERE NEW.type IN ('expectation.created', 'expectation.updated')
    AND (
      COALESCE(json_type(NEW.payload_json, '$.id'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.id'), '') = ''
      OR COALESCE(json_type(NEW.payload_json, '$.source'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.subject'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.verification'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.createdAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.validFrom'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.status'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.updatedAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.evidence'), '') <> 'array'
      OR COALESCE(json_array_length(NEW.payload_json, '$.evidence'), 0) < 1
      OR COALESCE(NEW.operation_id, '') = ''
    );

  SELECT RAISE(ABORT, 'verification request payload is malformed')
  WHERE NEW.type = 'verification.requested'
    AND (
      COALESCE(json_type(NEW.payload_json, '$.expectationId'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.expectationId'), '') = ''
      OR COALESCE(json_type(NEW.payload_json, '$.requestId'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.requestId'), '') = ''
      OR COALESCE(json_type(NEW.payload_json, '$.requestedAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.verifier'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.mode'), '') <> 'text'
    );

  SELECT RAISE(ABORT, 'verification result payload is malformed')
  WHERE NEW.type = 'verification.completed'
    AND (
      COALESCE(json_type(NEW.payload_json, '$.result'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.result.id'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.result.expectationId'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.result.expectationId'), '') = ''
      OR COALESCE(json_extract(NEW.payload_json, '$.result.outcome'), '') NOT IN ('satisfied', 'violated', 'unknown')
      OR COALESCE(json_type(NEW.payload_json, '$.result.verifier'), '') <> 'object'
      OR COALESCE(json_type(NEW.payload_json, '$.result.observedAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.result.evidence'), '') <> 'array'
      OR COALESCE(json_array_length(NEW.payload_json, '$.result.evidence'), 0) < 1
    );

  SELECT RAISE(ABORT, 'expectation control payload is malformed')
  WHERE NEW.type = 'expectation.cancelled'
    AND (
      COALESCE(json_type(NEW.payload_json, '$.expectationId'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.expectationId'), '') = ''
      OR COALESCE(json_type(NEW.payload_json, '$.cancelledAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.reason'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.reason'), '') = ''
    );

  SELECT RAISE(ABORT, 'expectation status payload is malformed')
  WHERE NEW.type = 'expectation.status.changed'
    AND (
      COALESCE(json_type(NEW.payload_json, '$.expectationId'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.expectationId'), '') = ''
      OR COALESCE(json_extract(NEW.payload_json, '$.from'), '') NOT IN ('pending', 'satisfied', 'violated', 'expired', 'unknown')
      OR COALESCE(json_extract(NEW.payload_json, '$.to'), '') NOT IN ('pending', 'satisfied', 'violated', 'expired', 'unknown')
      OR COALESCE(json_type(NEW.payload_json, '$.changedAt'), '') <> 'text'
      OR COALESCE(json_type(NEW.payload_json, '$.reason'), '') <> 'text'
      OR COALESCE(json_extract(NEW.payload_json, '$.reason'), '') = ''
    );
END;

DROP TRIGGER IF EXISTS phase3_derived_events_immutable;
CREATE TRIGGER phase3_derived_events_immutable
BEFORE UPDATE ON events
WHEN OLD.type IN (
  'expectation.registered',
  'expectation.created',
  'expectation.updated',
  'expectation.cancelled',
  'expectation.status.changed',
  'verification.requested',
  'verification.completed',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
) OR NEW.type IN (
  'expectation.registered',
  'expectation.created',
  'expectation.updated',
  'expectation.cancelled',
  'expectation.status.changed',
  'verification.requested',
  'verification.completed',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
)
BEGIN
  SELECT RAISE(ABORT, 'Phase 3 domain events are append-only');
END;

DROP TRIGGER IF EXISTS phase3_derived_events_no_delete;
CREATE TRIGGER phase3_derived_events_no_delete
BEFORE DELETE ON events
WHEN OLD.type IN (
  'expectation.registered',
  'expectation.created',
  'expectation.updated',
  'expectation.cancelled',
  'expectation.status.changed',
  'verification.requested',
  'verification.completed',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
)
AND NOT EXISTS (
  SELECT 1
  FROM privacy_purge_authorizations
  WHERE active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'Phase 3 domain events are append-only');
END;
