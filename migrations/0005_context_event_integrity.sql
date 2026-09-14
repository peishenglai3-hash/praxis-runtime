-- Enforce the minimum context event lineage at the ledger boundary.
-- Runtime validation remains the richer semantic gate; these triggers prevent
-- a low-level EventWriter caller from bypassing the recorded plan/source chain.

CREATE TRIGGER context_plan_created_integrity
BEFORE INSERT ON events
WHEN NEW.type = 'context.plan.created'
BEGIN
  SELECT RAISE(ABORT, 'context plan failed ledger integrity checks')
  WHERE COALESCE(json_extract(NEW.payload_json, '$.classification'), '') <> 'candidate'
     OR COALESCE(json_extract(NEW.payload_json, '$.planId'), '') = ''
     OR COALESCE(NEW.operation_id, '') <> COALESCE(json_extract(NEW.payload_json, '$.planId'), '')
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.candidateSources'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.stateSeq'), '') <> 'integer'
     OR EXISTS (
       SELECT 1
       FROM json_each(NEW.payload_json, '$.candidateSources') candidate
       LEFT JOIN events source
         ON source.id = json_extract(candidate.value, '$.sourceEventId')
       WHERE source.id IS NULL
          OR source.seq <> CAST(json_extract(candidate.value, '$.seq') AS INTEGER)
          OR source.seq > CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER)
          OR json_extract(source.provenance_json, '$.origin')
             <> json_extract(candidate.value, '$.sourceOrigin')
     );
END;

CREATE TRIGGER context_item_exposed_integrity
BEFORE INSERT ON events
WHEN NEW.type = 'context.item.exposed'
BEGIN
  SELECT RAISE(ABORT, 'context exposure failed ledger integrity checks')
  WHERE COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'inferred'
     OR COALESCE(json_extract(NEW.payload_json, '$.planId'), '') = ''
     OR COALESCE(json_extract(NEW.payload_json, '$.itemId'), '') = ''
     OR NOT EXISTS (
       SELECT 1
       FROM events source
       WHERE source.id = json_extract(NEW.payload_json, '$.sourceEventId')
         AND json_extract(source.provenance_json, '$.origin')
             = json_extract(NEW.payload_json, '$.sourceOrigin')
         AND source.seq <= CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER)
     )
     OR NOT EXISTS (
       SELECT 1
       FROM events plan
       JOIN json_each(plan.payload_json, '$.exposureProposals') proposal
       WHERE plan.type = 'context.plan.created'
         AND plan.operation_id = json_extract(NEW.payload_json, '$.planId')
         AND json_extract(proposal.value, '$.itemId')
             = json_extract(NEW.payload_json, '$.itemId')
         AND json_extract(proposal.value, '$.sourceId')
             = json_extract(NEW.payload_json, '$.sourceId')
         AND json_extract(proposal.value, '$.sourceEventId')
             = json_extract(NEW.payload_json, '$.sourceEventId')
         AND json_extract(proposal.value, '$.sourceOrigin')
             = json_extract(NEW.payload_json, '$.sourceOrigin')
         AND json_extract(proposal.value, '$.rankingVersion')
             = json_extract(NEW.payload_json, '$.rankingVersion')
         AND json_extract(proposal.value, '$.generatedAt')
             = json_extract(NEW.payload_json, '$.generatedAt')
         AND json_extract(proposal.value, '$.stateSeq')
             = json_extract(NEW.payload_json, '$.stateSeq')
         AND json_extract(proposal.value, '$.reason')
             = json_extract(NEW.payload_json, '$.reason')
         AND EXISTS (
           SELECT 1
           FROM json_each(COALESCE(NEW.links_json, '{}'), '$.respondsTo') link
           WHERE link.value = plan.id
         )
         AND EXISTS (
           SELECT 1
           FROM json_each(COALESCE(NEW.links_json, '{}'), '$.derivedFrom') link
           WHERE link.value = json_extract(NEW.payload_json, '$.sourceEventId')
         )
     );
END;
