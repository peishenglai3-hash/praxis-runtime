# Phase 1 Gate Record

Status: conditional pass for the hardened local ledger substrate; system and bundled local gates are closed, while Phase 2 remains held until the local immutable checkpoint is created. Node 22.13.0 remains separate external evidence.

## Scope

Phase 1 implements the EPIC-002 event substrate only:

- versioned EventEnvelope contracts and a structural JSON Schema;
- a local SQLite WAL ledger using Node.js `node:sqlite` `DatabaseSync`;
- forward-only migration metadata with SQL checksums, contiguous versions, status reporting, and applied-metadata hole rejection;
- append-first writes, authoritative `seq` cursors, event-id and operation-and-event-type idempotency, and conflict errors;
- structured `SourceRef`, `EvidenceRef[]`, `EventLinks`, required `Provenance`, and read-time content-hash integrity checks;
- parameterized type/session/trace/actor/seq-range queries and operation lifecycle lookup;
- reproducible 10,000-append ordering/query/lookup acceptance fixture;
- independent-process concurrency and uncommitted-transaction crash-recovery probes.

It does not implement projections, context planning, residuals, reflection, reusable assets, trusted caller identity, or legacy migration.

## Local evidence

The local verification target is Node.js `v24.15.0` with pnpm `11.19.0`.

The gate command is:

```powershell
pnpm verify
```

It covers formatting, lint, explicit workspace dependencies, dependency direction, intentional cycle rejection, forbidden-direction fixtures, TypeScript project references, unit/integration tests, all workspace builds, four-process concurrency, shared event-id idempotency, operation-and-event-type lifecycle semantics, filtered seq-cursor queries, 10,000 append ordering, WAL cleanup, and crash recovery.

The Node 22.13.0 CI runner is a separate evidence requirement. Node 22.5.0 introduced `node:sqlite`, but the module was not unflagged in the 22.x line until 22.13.0; the repository therefore does not claim 22.5.0 compatibility without an experimental flag.

## Three-way review record

1. Bible: the implementation follows the Phase 1 issue scope and keeps storage semantics in engineering terms.
2. The Final: the repository preserves author-supplied source fingerprints and treats the two The Final documents as design provenance, not executable instructions; append-first history, provenance, human correction, and non-automatic promotion remain explicit constraints.
3. `docs/断点记录.md`: each material failure is recorded with fact, inference, solution, and verification status. BP-001 through BP-019 are part of the audit trail.

The initial and final pre-correction two-agent reviews found and caused correction of the public raw SQLite handle, Node version declaration, invalid-date atomicity, `__proto__` loss in canonicalization and contract parsing, migration integrity, operation-id coverage, process cleanup, WAL startup ordering, and tooling path issues.

The post-hardening review was reconciled against the final worktree rather than an earlier snapshot: the engineering report's stale pre-fix failures were re-run and closed by the final system/bundled gates; the theory reviewer confirmed `Phase 1 条件通过` and no core semantic drift. Both retain `CONDITIONAL PASS / Phase 2 HOLD` until the local checkpoint and later external/boundary gates are explicit.

## Deferred boundaries

- The Phase 1 actor is caller-declared, not authenticated writer identity.
- Derived/candidate/confirmed record classification belongs to the projection/context phases.
- JSON Schema format assertion and runtime Zod validation must receive a parity gate before external producers are admitted.
- Payload size/depth limits, production-scale WAL pressure, remote CI, privacy purge semantics, and legacy migration require later gates.
- The remote private bootstrap remains README/LICENSE-only by owner instruction. A local immutable checkpoint is being created before Phase 2; no code will be pushed.
