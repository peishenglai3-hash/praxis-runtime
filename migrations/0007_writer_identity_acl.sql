-- Phase 3.5 writer provenance. Actor remains part of the immutable event
-- envelope; writer_json records the authenticated registration context.

ALTER TABLE events ADD COLUMN writer_json TEXT;

UPDATE events
SET writer_json = '{"writerId":"system:migration","kind":"runtime","role":"MIGRATION","authn":"system","scopes":["system.migrate"],"policyVersion":1}'
WHERE writer_json IS NULL;

CREATE INDEX idx_events_writer ON events(writer_json);

CREATE TRIGGER events_writer_integrity
BEFORE INSERT ON events
WHEN COALESCE(json_type(NEW.writer_json, '$'), '') <> 'object'
  OR COALESCE(json_type(NEW.writer_json, '$.writerId'), '') <> 'text'
  OR COALESCE(json_extract(NEW.writer_json, '$.writerId'), '') = ''
  OR COALESCE(json_type(NEW.writer_json, '$.kind'), '') <> 'text'
  OR COALESCE(json_type(NEW.writer_json, '$.role'), '') <> 'text'
  OR COALESCE(json_type(NEW.writer_json, '$.authn'), '') <> 'text'
  OR COALESCE(json_type(NEW.writer_json, '$.scopes'), '') <> 'array'
  OR COALESCE(json_type(NEW.writer_json, '$.policyVersion'), '') <> 'integer'
  OR CAST(json_extract(NEW.writer_json, '$.policyVersion') AS INTEGER) < 1
BEGIN
  SELECT RAISE(ABORT, 'event writer provenance is required and malformed');
END;
