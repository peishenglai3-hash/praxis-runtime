# ADR-0006: Phase 3 Derived-Event Integrity

## Status

Accepted for the bounded Phase 3 implementation; authorization and production assembly remain separate decisions.

## Context

Phase 3 adds `expectation.registered`, `residual.detected`, and `reflection.proposed` as append-only derived or declared event materials. Runtime checks alone are insufficient because any caller with an `EventWriter` reference could otherwise submit a valid-looking but detached payload. The Bible also requires explicit evidence, provenance, bounded reflection, replayable cursor relationships, and no silent promotion of a proposal into an active asset.

## Decision

Use four complementary defenses:

1. `packages/contracts` owns canonical Zod validation for Phase 3 payload and envelope semantics, including deterministic IDs, timestamps, provenance, evidence, outcome baselines, reflection decisions, budgets, and action-permission mappings.
2. `SqliteEventStore` validates every batch before opening its append transaction. `EventBatchWriter` is documented as all-or-none and idempotent at the operation boundary.
3. Migration `0006_phase3_derived_integrity.sql` provides database-local checks for evidence existence, source lineage, ledger cursor bounds, outcome baseline equality, timing cursor evidence, reflection round progression, and derived-event deletion/updates. Migration preflight rejects malformed or detached legacy rows before applying the triggers.
4. `Phase3Runtime` remains the only use-case composition boundary for generated residual/reflection events. It binds timing inputs to the ledger, chains reflection rounds from the residual cursor, and records proposals without executing actions or promoting assets.

## Consequences

- A direct generic `EventWriter` caller cannot bypass the Phase 3 material and lineage checks merely by constructing a structurally valid envelope.
- Existing migrations remain immutable; malformed legacy rows fail explicitly during migration instead of being silently repaired.
- Synthetic tests can prove implementation behavior but cannot establish trusted writer identity, ACL authorization, human-control semantics, production assembly, privacy policy, external verification policy, or authorial correctness.
- `requiredPermission` remains descriptive proposal metadata until an owner-approved authorization/control layer exists. It must not be treated as a grant.
- The current synthetic expectation policy uses an inclusive `validUntil` boundary and is recorded as a provisional owner input, not as an author-confirmed rule.

## Rejected alternatives

- Runtime-only validation: leaves a low-level writer bypass.
- A single global Judge or automatic effect inference: collapses unknown consequences and external disagreement into an unsupported internal decision.
- Rewriting old migrations or repairing malformed legacy rows in place: destroys the evidence needed to audit the migration boundary.
- Implementing ACL, human control, or action execution inside Phase 3: would claim authority and production behavior without the required human inputs.
