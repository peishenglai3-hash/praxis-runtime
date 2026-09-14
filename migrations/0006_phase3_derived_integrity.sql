-- Phase 3 low-level integrity guards.
--
-- These triggers are deliberately narrower than an authorization system. They
-- protect the event ledger from malformed or detached Phase 3 material even
-- when a caller reaches the generic EventWriter surface directly. Runtime
-- use-cases remain the semantic and human-control boundary.

CREATE TRIGGER expectation_registered_integrity
BEFORE INSERT ON events
WHEN NEW.type = 'expectation.registered'
BEGIN
  SELECT RAISE(ABORT, 'expectation registration failed ledger integrity checks')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'declared'
     OR COALESCE(json_type(NEW.payload_json, '$.expectationId'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.expectationId'), '') = ''
     OR COALESCE(NEW.operation_id, '') <> COALESCE(json_extract(NEW.payload_json, '$.expectationId'), '')
     OR COALESCE(json_type(NEW.payload_json, '$.subject'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.expected'), '') = ''
     OR COALESCE(json_type(NEW.payload_json, '$.verification'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.verification'), '') NOT IN ('exact', 'predicate', 'external')
     OR (json_extract(NEW.payload_json, '$.verification') = 'predicate'
         AND COALESCE(json_extract(NEW.payload_json, '$.predicateId'), '') = '')
     OR COALESCE(json_type(NEW.payload_json, '$.createdAt'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.evidence'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.payload_json, '$.evidence'), 0) < 1
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'declared'
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

CREATE TRIGGER context_plan_created_integrity_v2
BEFORE INSERT ON events
WHEN NEW.type = 'context.plan.created'
BEGIN
  SELECT RAISE(ABORT, 'context plan failed ledger integrity checks (strict v2)')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.payload_json, '$.classification'), '') <> 'candidate'
     OR COALESCE(json_extract(NEW.payload_json, '$.planId'), '') = ''
     OR COALESCE(NEW.operation_id, '') <> COALESCE(json_extract(NEW.payload_json, '$.planId'), '')
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.candidateSources'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.selected'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.reasons'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.exposureProposals'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.stateSeq'), '') <> 'integer'
     OR CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER) >
        COALESCE((SELECT MAX(seq) FROM events), 0)
     OR COALESCE(json_type(NEW.links_json, '$'), '') <> 'object'
     OR EXISTS (
       SELECT 1
       FROM json_each(NEW.payload_json, '$.candidateSources') candidate
       LEFT JOIN events source
         ON source.id = json_extract(candidate.value, '$.sourceEventId')
       WHERE COALESCE(json_type(candidate.value, '$.id'), '') <> 'text'
          OR COALESCE(json_type(candidate.value, '$.sourceEventId'), '') <> 'text'
          OR COALESCE(json_type(candidate.value, '$.seq'), '') <> 'integer'
          OR COALESCE(json_extract(candidate.value, '$.sourceOrigin'), '') NOT IN
             ('direct', 'declared', 'inferred', 'institutional')
          OR source.id IS NULL
          OR source.seq <> CAST(json_extract(candidate.value, '$.seq') AS INTEGER)
          OR source.seq > CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER)
          OR COALESCE(json_extract(source.provenance_json, '$.origin'), '') <>
             COALESCE(json_extract(candidate.value, '$.sourceOrigin'), '')
          OR NOT EXISTS (
             SELECT 1
             FROM json_each(NEW.links_json, '$.derivedFrom') link
             WHERE link.value = json_extract(candidate.value, '$.sourceEventId')
          )
     );
END;

CREATE TRIGGER context_item_exposed_integrity_v2
BEFORE INSERT ON events
WHEN NEW.type = 'context.item.exposed'
BEGIN
  SELECT RAISE(ABORT, 'context exposure failed ledger integrity checks (strict v2)')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.planId'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.planId'), '') = ''
     OR COALESCE(json_type(NEW.payload_json, '$.itemId'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.itemId'), '') = ''
     OR COALESCE(json_type(NEW.payload_json, '$.sourceEventId'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.sourceOrigin'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.sourceId'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.stateSeq'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.rankingVersion'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.generatedAt'), '') <> 'text'
     OR COALESCE(json_type(NEW.payload_json, '$.reason'), '') <> 'text'
     OR COALESCE(NEW.operation_id, '') NOT LIKE 'context-exposure:%:%'
     OR COALESCE(json_type(NEW.links_json, '$.respondsTo'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.links_json, '$.respondsTo'), 0) < 1
     OR COALESCE(json_type(NEW.links_json, '$.derivedFrom'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.links_json, '$.derivedFrom'), 0) < 1
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 2
     OR NOT EXISTS (
       SELECT 1
       FROM events source
       WHERE source.id = json_extract(NEW.payload_json, '$.sourceEventId')
         AND source.seq <= CAST(json_extract(NEW.payload_json, '$.stateSeq') AS INTEGER)
         AND COALESCE(json_extract(source.provenance_json, '$.origin'), '') =
             COALESCE(json_extract(NEW.payload_json, '$.sourceOrigin'), '')
     )
     OR NOT EXISTS (
       SELECT 1
       FROM events plan
       JOIN json_each(plan.payload_json, '$.exposureProposals') proposal
       WHERE plan.type = 'context.plan.created'
         AND plan.operation_id = json_extract(NEW.payload_json, '$.planId')
         AND json_extract(proposal.value, '$.itemId') = json_extract(NEW.payload_json, '$.itemId')
         AND json_extract(proposal.value, '$.sourceId') = json_extract(NEW.payload_json, '$.sourceId')
         AND json_extract(proposal.value, '$.sourceEventId') = json_extract(NEW.payload_json, '$.sourceEventId')
         AND json_extract(proposal.value, '$.sourceOrigin') = json_extract(NEW.payload_json, '$.sourceOrigin')
         AND json_extract(proposal.value, '$.rankingVersion') = json_extract(NEW.payload_json, '$.rankingVersion')
         AND json_extract(proposal.value, '$.generatedAt') = json_extract(NEW.payload_json, '$.generatedAt')
         AND json_extract(proposal.value, '$.stateSeq') = json_extract(NEW.payload_json, '$.stateSeq')
         AND json_extract(proposal.value, '$.reason') = json_extract(NEW.payload_json, '$.reason')
         AND EXISTS (
           SELECT 1
           FROM json_each(NEW.links_json, '$.respondsTo') link
           WHERE link.value = plan.id
         )
         AND EXISTS (
           SELECT 1
           FROM json_each(NEW.links_json, '$.derivedFrom') link
           WHERE link.value = json_extract(NEW.payload_json, '$.sourceEventId')
         )
     );
END;

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
                WHERE expectation.type = 'expectation.registered'
                  AND expectation.operation_id = json_extract(NEW.payload_json, '$.baselineId')
                  AND json_extract(expectation.payload_json, '$.expectationId') = json_extract(NEW.payload_json, '$.baselineId')
                  AND COALESCE(json_extract(expectation.provenance_json, '$.origin'), '') = 'declared'
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

CREATE TRIGGER reflection_proposed_integrity
BEFORE INSERT ON events
WHEN NEW.type = 'reflection.proposed'
BEGIN
  SELECT RAISE(ABORT, 'reflection proposal failed ledger integrity checks')
  WHERE COALESCE(json_type(NEW.payload_json, '$'), '') <> 'object'
     OR COALESCE(json_extract(NEW.payload_json, '$.materialClassification'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.payload_json, '$.residualId'), '') <> 'text'
     OR COALESCE(json_extract(NEW.payload_json, '$.residualId'), '') = ''
     OR COALESCE(json_extract(NEW.payload_json, '$.decision'), '') NOT IN ('STOP', 'CONTINUE', 'ESCALATE')
     OR COALESCE(json_type(NEW.payload_json, '$.reasons'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.payload_json, '$.reasons'), 0) < 1
     OR COALESCE(json_type(NEW.payload_json, '$.hypotheses'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.recommendedActions'), '') <> 'array'
     OR COALESCE(json_type(NEW.payload_json, '$.budget'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.budgetUsed'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.evidenceDelta'), '') <> 'object'
     OR COALESCE(json_type(NEW.payload_json, '$.evidenceDelta.fromSeq'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.evidenceDelta.toSeq'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.evidenceDelta.evidence'), '') <> 'array'
     OR CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) <
        CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER)
     OR (CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) =
         CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER)
         AND COALESCE(json_array_length(NEW.payload_json, '$.evidenceDelta.evidence'), 0) <> 0)
     OR (CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) >
         CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER)
         AND COALESCE(json_array_length(NEW.payload_json, '$.evidenceDelta.evidence'), 0) < 1)
     OR (json_extract(NEW.payload_json, '$.decision') = 'STOP'
         AND (COALESCE(json_array_length(NEW.payload_json, '$.hypotheses'), 0) <> 0
              OR COALESCE(json_array_length(NEW.payload_json, '$.recommendedActions'), 0) <> 0))
     OR (json_extract(NEW.payload_json, '$.decision') IN ('CONTINUE', 'ESCALATE')
         AND COALESCE(json_array_length(NEW.payload_json, '$.hypotheses'), 0) < 1)
     OR EXISTS (
       SELECT 1
       FROM json_each(NEW.payload_json, '$.reasons') reason
       WHERE reason.type <> 'text'
          OR COALESCE(reason.value, '') = ''
     )
     OR COALESCE(json_type(NEW.evidence_json, '$'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.evidence_json), 0) < 1
     OR COALESCE(json_type(NEW.payload_json, '$.budget.maxDepth'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budget.maxHypotheses'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budget.maxToolCalls'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budget.maxElapsedMs'), '') <> 'integer'
     OR CAST(json_extract(NEW.payload_json, '$.budget.maxDepth') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budget.maxHypotheses') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budget.maxToolCalls') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budget.maxElapsedMs') AS INTEGER) < 0
     OR COALESCE(json_type(NEW.payload_json, '$.budgetUsed.depth'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budgetUsed.hypotheses'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budgetUsed.toolCalls'), '') <> 'integer'
     OR COALESCE(json_type(NEW.payload_json, '$.budgetUsed.elapsedMs'), '') <> 'integer'
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.depth') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.hypotheses') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.toolCalls') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.elapsedMs') AS INTEGER) < 0
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.depth') AS INTEGER) >
        CAST(json_extract(NEW.payload_json, '$.budget.maxDepth') AS INTEGER)
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.hypotheses') AS INTEGER) >
        CAST(json_extract(NEW.payload_json, '$.budget.maxHypotheses') AS INTEGER)
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.toolCalls') AS INTEGER) >
        CAST(json_extract(NEW.payload_json, '$.budget.maxToolCalls') AS INTEGER)
     OR CAST(json_extract(NEW.payload_json, '$.budgetUsed.elapsedMs') AS INTEGER) >
        CAST(json_extract(NEW.payload_json, '$.budget.maxElapsedMs') AS INTEGER)
     OR (json_extract(NEW.payload_json, '$.decision') <> 'STOP'
         AND CAST(json_extract(NEW.payload_json, '$.budgetUsed.depth') AS INTEGER) < 1)
     OR COALESCE(NEW.operation_id, '') <> 'reflection:' ||
        json_extract(NEW.payload_json, '$.residualId') || ':' ||
        CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS TEXT)
     OR COALESCE(json_extract(NEW.provenance_json, '$.origin'), '') <> 'inferred'
     OR COALESCE(json_type(NEW.links_json, '$.respondsTo'), '') <> 'array'
     OR COALESCE(json_array_length(NEW.links_json, '$.respondsTo'), 0) < 1
     OR COALESCE(json_type(NEW.links_json, '$.derivedFrom'), '') <> 'array'
     OR NOT EXISTS (
       SELECT 1
       FROM json_each(NEW.links_json, '$.respondsTo') link
       JOIN events residual ON residual.id = link.value
       WHERE residual.type = 'residual.detected'
         AND json_extract(residual.payload_json, '$.residualId') =
             json_extract(NEW.payload_json, '$.residualId')
     )
     OR NOT EXISTS (
       SELECT 1
       FROM json_each(NEW.links_json, '$.derivedFrom') link
       WHERE link.value IN (
         SELECT id
         FROM events residual
         WHERE residual.type = 'residual.detected'
           AND json_extract(residual.payload_json, '$.residualId') =
               json_extract(NEW.payload_json, '$.residualId')
       )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM json_each(NEW.payload_json, '$.evidenceDelta.evidence') evidence
       JOIN events source ON source.id = json_extract(evidence.value, '$.eventId')
       WHERE source.seq > CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER)
         AND source.seq <= CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER)
         AND COALESCE(json_extract(source.provenance_json, '$.origin'), '') =
             COALESCE(json_extract(evidence.value, '$.origin'), '')
     )
     AND CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) >
         CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER);

  SELECT RAISE(ABORT, 'reflection proposal round is not monotonic')
  WHERE (
    (SELECT COUNT(*)
     FROM events previous
     WHERE previous.type = 'reflection.proposed'
       AND json_extract(previous.payload_json, '$.residualId') =
           json_extract(NEW.payload_json, '$.residualId')) = 0
    AND CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER) <>
        COALESCE((
          SELECT residual.seq
          FROM json_each(NEW.links_json, '$.respondsTo') link
          JOIN events residual ON residual.id = link.value
          WHERE residual.type = 'residual.detected'
            AND json_extract(residual.payload_json, '$.residualId') =
                json_extract(NEW.payload_json, '$.residualId')
          LIMIT 1
        ), -1)
  )
  OR (
    (SELECT COUNT(*)
     FROM events previous
     WHERE previous.type = 'reflection.proposed'
       AND json_extract(previous.payload_json, '$.residualId') =
           json_extract(NEW.payload_json, '$.residualId')) > 0
    AND CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER) <>
        (SELECT MAX(CAST(json_extract(previous.payload_json, '$.evidenceDelta.toSeq') AS INTEGER))
         FROM events previous
         WHERE previous.type = 'reflection.proposed'
           AND json_extract(previous.payload_json, '$.residualId') =
               json_extract(NEW.payload_json, '$.residualId'))
  )
  OR (
    (SELECT COUNT(*)
     FROM events previous
     WHERE previous.type = 'reflection.proposed'
       AND json_extract(previous.payload_json, '$.residualId') =
           json_extract(NEW.payload_json, '$.residualId')) > 0
    AND CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) <=
        (SELECT MAX(CAST(json_extract(previous.payload_json, '$.evidenceDelta.toSeq') AS INTEGER))
         FROM events previous
         WHERE previous.type = 'reflection.proposed'
           AND json_extract(previous.payload_json, '$.residualId') =
               json_extract(NEW.payload_json, '$.residualId'))
  )
  OR (
    (SELECT COUNT(*)
     FROM events previous
     WHERE previous.type = 'reflection.proposed'
       AND json_extract(previous.payload_json, '$.residualId') =
           json_extract(NEW.payload_json, '$.residualId')) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(NEW.links_json, '$.supersedes') link
      WHERE link.value = (
        SELECT previous.id
        FROM events previous
        WHERE previous.type = 'reflection.proposed'
          AND json_extract(previous.payload_json, '$.residualId') =
              json_extract(NEW.payload_json, '$.residualId')
        ORDER BY CAST(json_extract(previous.payload_json, '$.evidenceDelta.toSeq') AS INTEGER) DESC,
                 previous.seq DESC
        LIMIT 1
      )
    )
  );

  SELECT RAISE(ABORT, 'reflection proposal evidence is outside its ledger round')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.payload_json, '$.evidenceDelta.evidence') evidence
    LEFT JOIN events source ON source.id = json_extract(evidence.value, '$.eventId')
    WHERE json_type(evidence.value, '$.eventId') = 'text'
      AND (
        source.id IS NULL
        OR source.seq <= CAST(json_extract(NEW.payload_json, '$.evidenceDelta.fromSeq') AS INTEGER)
        OR source.seq > CAST(json_extract(NEW.payload_json, '$.evidenceDelta.toSeq') AS INTEGER)
        OR COALESCE(json_extract(source.provenance_json, '$.origin'), '') <>
           COALESCE(json_extract(evidence.value, '$.origin'), '')
      )
  );
END;

CREATE TRIGGER phase3_derived_events_immutable
BEFORE UPDATE ON events
WHEN OLD.type IN (
  'expectation.registered',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
) OR NEW.type IN (
  'expectation.registered',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
)
BEGIN
  SELECT RAISE(ABORT, 'Phase 3 domain events are append-only');
END;

CREATE TRIGGER phase3_derived_events_no_delete
BEFORE DELETE ON events
WHEN OLD.type IN (
  'expectation.registered',
  'context.plan.created',
  'context.item.exposed',
  'residual.detected',
  'reflection.proposed'
)
BEGIN
  SELECT RAISE(ABORT, 'Phase 3 domain events are append-only');
END;
