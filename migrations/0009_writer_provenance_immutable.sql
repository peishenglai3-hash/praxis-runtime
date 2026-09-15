-- Phase 3.5 follow-up: writer provenance and its envelope hash are immutable.
-- Normal corrections remain new events; this trigger is intentionally global.

DROP TRIGGER IF EXISTS events_writer_integrity;
CREATE TRIGGER events_writer_integrity
BEFORE INSERT ON events
WHEN COALESCE(json_type(NEW.writer_json, '$'), '') <> 'object'
  OR COALESCE(json_type(NEW.writer_json, '$.writerId'), '') <> 'text'
  OR COALESCE(json_extract(NEW.writer_json, '$.writerId'), '') = ''
  OR COALESCE(json_extract(NEW.writer_json, '$.kind'), '') NOT IN
     ('human', 'runtime', 'agent', 'adapter', 'importer')
  OR COALESCE(json_extract(NEW.writer_json, '$.role'), '') NOT IN
     ('OWNER', 'OBSERVER', 'ANALYZER', 'VERIFIER', 'COORDINATOR',
      'ADAPTER', 'IMPORTER', 'MIGRATION')
  OR COALESCE(json_extract(NEW.writer_json, '$.authn'), '') NOT IN
     ('embedded-local', 'daemon-token', 'system')
  OR COALESCE(json_type(NEW.writer_json, '$.scopes'), '') <> 'array'
  OR COALESCE(json_array_length(NEW.writer_json, '$.scopes'), 0) < 1
  OR COALESCE(json_type(NEW.writer_json, '$.policyVersion'), '') <> 'integer'
  OR json_extract(NEW.writer_json, '$.policyVersion') <> 1
BEGIN
  SELECT RAISE(ABORT, 'event writer provenance is required and malformed');
END;

-- The Phase 3 trigger predates structured Phase 3.5 expectations. Recreate
-- the same low-level residual checks while accepting either the legacy
-- expectation.registered or the structured expectation.created baseline.
DROP TRIGGER IF EXISTS residual_detected_integrity;
CREATE TRIGGER residual_detected_integrity
BEFORE INSERT ON events
WHEN NEW.type = 'residual.detected'
BEGIN
  SELECT RAISE(ABORT, 'residual detection failed ledger integrity checks')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.residualId'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.residualId'), '') = ''
     OR COALESCE(NEW.operation_id, '') <> COALESCE(json_extract(NEW.payload_json, '$.residualId'), '')
     OR COALESCE(json_extract(NEW.payload_json, '$.kind'), '') NOT IN
        ('outcome', 'timing', 'rule', 'representation', 'relation', 'retrospective')
     OR COALESCE(json_extract(NEW.payload_json, '$.effect'), '') <> 'unknown'
     OR COALESCE(json_type(NEW.payload_json, '$.observed'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.field'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.confidence'), '') NOT IN ('integer', 'real')
     OR CAST(json_extract(NEW.payload_json, '$.confidence') AS REAL) < 0
     OR CAST(json_extract(NEW.payload_json, '$.confidence') AS REAL) > 1
     OR COALESCE(json_extract(NEW.payload_json, '$.persistence'), '') NOT IN
        ('transient', 'repeated', 'persistent')
     OR COALESCE(json_type(NEW.payload_json, '$.evidence'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.payload_json, '$.evidence'), 0) < 1
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.detectedAt'), '') <> 'text'
     OR (json_extract(NEW.payload_json, '$.kind') = 'timing'
          AND (COALESCE(json_type(NEW.payload_json, '$.observed.value.cursorSeq'), '') <> 'integer'
               OR COALESCE(json_type(NEW.payload_json, '$.observed.value.latestRelevantSeq'), '') <> 'integer'
               OR CAST(json_extract(NEW.payload_json, '$.observed.value.cursorSeq') AS INTEGER) < 0
               OR CAST(json_extract(NEW.payload_json, '$.observed.value.latestRelevantSeq') AS INTEGER) < 0
               OR CAST(json_extract(NEW.payload_json, '$.observed.value.latestRelevantSeq') AS INTEGER) <
                  CAST(json_extract(NEW.payload_json, '$.observed.value.cursorSeq') AS INTEGER)
               OR CAST(json_extract(NEW.payload_json, '$.observed.value.latestRelevantSeq') AS INTEGER) >
                  COALESCE((SELECT MAX(seq) FROM events), 0)
               OR NOT EXISTS (
                 SELECT 1
                 FROM json_each(NEW.evidence_json) evidence
                 JOIN events source ON source.id = json_extract(evidence.value, '$.eventId')
                 WHERE json_type(evidence.value, '$.eventId') = 'text'
                   AND source.seq = CAST(json_extract(NEW.payload_json, '$.observed.value.latestRelevantSeq') AS INTEGER)
               )))
     OR (json_extract(NEW.payload_json, '$.kind') = 'outcome'
          AND (COALESCE(json_extract(NEW.payload_json, '$.baselineId'), '') = ''
               OR COALESCE(json_type(NEW.payload_json, '$.baseline'), '') <> 'object'
               OR NOT EXISTS (
                 SELECT 1
                 FROM events expectation
                 WHERE COALESCE(json_extract(expectation.provenance_json, '$.origin'), '') = 'declared'
                   AND (
                     (expectation.type = 'expectation.registered'
                      AND expectation.operation_id = json_extract(NEW.payload_json, '$.baselineId')
                      AND json_extract(expectation.payload_json, '$.expectationId') = json_extract(NEW.payload_json, '$.baselineId'))
                     OR
                     (expectation.type = 'expectation.created'
                      AND json_extract(expectation.payload_json, '$.id') = json_extract(NEW.payload_json, '$.baselineId'))
                   )
                   AND json_extract(expectation.payload_json, '$.subject.kind') =
                       json_extract(NEW.payload_json, '$.baseline.kind')
                   AND json_extract(expectation.payload_json, '$.subject.id') =
                       json_extract(NEW.payload_json, '$.baseline.id')
                   AND json_extract(expectation.payload_json, '$.expected') IS
                       json_extract(NEW.payload_json, '$.baseline.value')
               )))
     OR EXISTS (
       SELECT 1
       FROM json_each(NEW.evidence_json) evidence
       WHERE COALESCE(json_extract(evidence.value, '$.origin'), '') NOT IN
             ('direct', 'declared', 'inferred', 'institutional')
          OR COALESCE(
               json_type(evidence.value, '$.eventId'),
               json_type(evidence.value, '$.assetId'),
               json_type(evidence.value, '$.artifactHash'),
               ''
             ) = ''
          OR (json_type(evidence.value, '$.eventId') = 'text'
              AND NOT EXISTS (
                SELECT 1
                FROM events source
                WHERE source.id = json_extract(evidence.value, '$.eventId')
                  AND COALESCE(json_extract(source.provenance_json, '$.origin'), '') =
                      COALESCE(json_extract(evidence.value, '$.origin'), '')
              ))
      );
END;

DROP TRIGGER IF EXISTS phase35_writer_provenance_immutable;
CREATE TRIGGER phase35_writer_provenance_immutable
BEFORE UPDATE OF writer_json, content_hash ON events
BEGIN
  SELECT RAISE(ABORT, 'writer provenance and content hash are append-only');
END;
