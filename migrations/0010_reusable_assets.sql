-- Phase 4 reusable-asset catalog.
--
-- The event ledger remains authoritative. The assets table is a rebuildable
-- current catalog whose last_seq records the event that produced the row.
-- Managed lifecycle writes use one SQLite transaction for both records.

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN
    ('rule', 'skill', 'workflow', 'agent-policy', 'summary', 'pattern')),
  version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN
    ('draft', 'candidate', 'validated', 'active', 'challenged', 'deprecated')),
  body_json TEXT NOT NULL,
  derived_from_json TEXT NOT NULL,
  forked_from_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);

CREATE INDEX IF NOT EXISTS idx_assets_status_kind
  ON assets(status, kind, updated_at);

CREATE INDEX IF NOT EXISTS idx_assets_last_seq
  ON assets(last_seq);

-- A managed lifecycle event must carry the complete next asset snapshot. The
-- generic EventWriter path is intentionally not enough for these events.
CREATE TRIGGER asset_lifecycle_integrity
BEFORE INSERT ON events
WHEN NEW.type IN (
  'asset.validated',
  'asset.activate',
  'asset.contest',
  'asset.disable',
  'asset.restore',
  'asset.fork'
)
OR (NEW.type = 'asset.candidate'
    AND COALESCE(json_type(NEW.payload_json, '$.asset'), '') = 'object')
BEGIN
  SELECT RAISE(ABORT, 'managed asset event requires a complete asset snapshot')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.asset'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.asset.id'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.asset.id'), '') = ''
     OR COALESCE(json_type(NEW.payload_json, '$.asset.kind'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.asset.version'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.asset.revision'), '') <> 'integer'
     OR CAST(json_extract(NEW.payload_json, '$.asset.revision') AS INTEGER) < 1
     OR COALESCE(json_type(NEW.payload_json, '$.asset.status'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.asset.body'), '') = ''
     OR COALESCE(json_type(NEW.payload_json, '$.asset.derivedFrom'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.payload_json, '$.asset.derivedFrom'), 0) < 1
     OR COALESCE(json_type(NEW.payload_json, '$.asset.createdAt'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.asset.updatedAt'), '') <> 'text'
     OR COALESCE(NEW.operation_id, '') = ''
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') NOT IN
        ('declared', 'inferred')
     OR (NEW.type = 'asset.candidate'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'candidate')
     OR (NEW.type = 'asset.validated'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'validated')
     OR (NEW.type = 'asset.activate'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'active')
     OR (NEW.type = 'asset.contest'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'challenged')
     OR (NEW.type = 'asset.disable'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'deprecated')
     OR (NEW.type = 'asset.fork'
         AND json_extract(NEW.payload_json, '$.asset.status') <> 'candidate');
END;

DROP TRIGGER IF EXISTS asset_lifecycle_immutable;
CREATE TRIGGER asset_lifecycle_immutable
BEFORE UPDATE ON events
WHEN OLD.type LIKE 'asset.%' OR NEW.type LIKE 'asset.%'
BEGIN
  SELECT RAISE(ABORT, 'reusable-asset lifecycle events are append-only');
END;

DROP TRIGGER IF EXISTS asset_lifecycle_no_delete;
CREATE TRIGGER asset_lifecycle_no_delete
BEFORE DELETE ON events
WHEN OLD.type LIKE 'asset.%'
AND NOT EXISTS (
  SELECT 1
  FROM privacy_purge_authorizations
  WHERE active = 1
)
BEGIN
  SELECT RAISE(ABORT, 'reusable-asset lifecycle events are append-only');
END;
