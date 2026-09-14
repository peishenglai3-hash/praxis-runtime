# Phase 0 and Phase 1 Audit

Date: 2026-09-14

Status: CONDITIONAL PASS for the hardened local implementation; Phase 2 remains HOLD pending final three-way review, local immutable checkpoint, and Node 22.13.0 runner evidence.

## Scope and source order

This audit compares the current worktree with the frozen `Codex Implementation Bible v1.0`, the two author-supplied The Final documents, the repository RFC/ADRs, and `docs/断点记录.md`. The Bible supplies the implementation and acceptance baseline. The Final documents supply intellectual provenance and boundary constraints; they are not executable instructions. Current repository behavior and test output are evidence; previous assistant or agent summaries are retrospective records only.

The first-generation public `codex-habit` repository remains a separate historical input. No first-generation source code has been copied into this worktree.

## Findings before remediation

| ID      | Finding                                                                                                                                                                                               | Severity          | Evidence                                                                    | Required disposition                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-001 | EventEnvelope currently accepts arbitrary JSON for `source`, `evidence`, `links`, and optional `provenance`; the Bible freezes `SourceRef`, `EvidenceRef[]`, `EventLinks`, and required `Provenance`. | Critical          | `packages/contracts/src/events.ts`, `schemas/event-envelope.v1.schema.json` | Align the contract, schema, fixtures, and migration without rewriting an applied migration.                                                     |
| AUD-002 | A unique index on `operation_id` prevents the Bible's `tool.requested`, `tool.succeeded`, and `tool.failed` lifecycle events from sharing one operation id.                                           | Critical          | `migrations/0001_init.sql`, `packages/store/src/sqlite.ts`                  | Replace with operation-and-event-type idempotency and expose an operation-state lookup.                                                         |
| AUD-003 | The existing verify path has no reproducible 10,000-append acceptance test.                                                                                                                           | Required          | `package.json`, `scripts/`                                                  | Add a bounded throughput/ordering fixture and include it in `pnpm verify`.                                                                      |
| AUD-004 | The reader surface lacks Bible-required type/session/trace/actor and explicit seq-range queries.                                                                                                      | Required          | `packages/contracts/src/events.ts`, `packages/store/src/sqlite.ts`          | Add one parameterized, paginated query contract with exclusive cursor semantics.                                                                |
| AUD-005 | Migration version is exposed, but there is no explicit safe migration status surface and applied metadata holes are not rejected before application.                                                  | Required          | `packages/store/src/migrations.ts`, `packages/store/src/sqlite.ts`          | Add status data and validate applied versions contiguously.                                                                                     |
| AUD-006 | The local code baseline has no commit; the remote private repository intentionally contains README/LICENSE only.                                                                                      | Rollback risk     | `git status`, remote tree audit                                             | Do not upload code. Establish a local immutable checkpoint before Phase 2 implementation or retain an explicit archive/patch rollback artifact. |
| AUD-007 | System and bundled Node are 24.15.0/24.19.0; the configured Node 22.13.0 CI runner has not executed.                                                                                                  | Required evidence | `.github/workflows/ci.yml`, BP-010/BP-016                                   | Keep the engine floor at `>=22.13.0`; do not claim runner compatibility until CI evidence exists.                                               |

## Previously recorded breakpoint recheck

BP-001 through BP-016 document the native-driver failure, `node:sqlite` adoption, migration races, WAL startup ordering, dependency graph resolution, raw-handle exposure, timestamp and hash integrity, tooling drift, and the unavailable Node 22.13.0 runner. The remediation pass must re-run the relevant tests and update each affected entry with current evidence; a historical “fixed” sentence is not a substitute for a current verification result.

## Remediation evidence — 2026-09-14

| Finding | Current disposition       | Evidence                                                                                                                                                                                            |
| ------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-001 | Resolved locally          | Structured `SourceRef`, `EvidenceRef[]`, `EventLinks`, required `Provenance`, matching JSON Schema, unit coverage, and store round-trip coverage.                                                   |
| AUD-002 | Resolved locally          | Forward-only migrations 0002/0003; one operation supports one idempotent event per lifecycle type; lifecycle lookup and conflict tests pass.                                                        |
| AUD-003 | Resolved locally          | `pnpm phase1:throughput`: 10,000 appends, ordered seq, filtered query, and operation lookup pass; latest local run was 30,851 ms. This is a recorded environment result, not a performance promise. |
| AUD-004 | Resolved locally          | `EventReader.query` uses parameterized exclusive seq cursors and type/session/trace/actor filters; integration coverage passes.                                                                     |
| AUD-005 | Resolved locally          | Migration status is exposed by the store; applied migration holes are rejected; checksum and hole tests pass.                                                                                       |
| AUD-006 | Pending checkpoint        | Remote tree remains README/LICENSE-only. A local immutable checkpoint must be created before Phase 2; the worktree is ready for that checkpoint.                                                    |
| AUD-007 | Pending external evidence | System Node 24.15.0 and bundled Node 24.19.0 pass local probes; Node 22.13.0 CI has not run because source has not been uploaded.                                                                   |

The first hardening test pass also recorded two repairable execution mismatches: a Jest-only `--runInBand` flag was rejected by Vitest, and the crash worker initially omitted the new NOT NULL provenance parameter. Neither changed production data; both were corrected and the intended tests were rerun successfully. A further migration preflight slice now rejects invalid legacy shape and hash before table replacement and proves rollback in integration tests.

## Rollback points

- The remote repository is a separate README-only bootstrap. Its verified tree contains only `README.md` and `LICENSE`; no local source, lockfile, database, or test output has been uploaded.
- The current worktree is still an uncommitted local implementation snapshot. Before Phase 2 code is accepted, create a local commit or an owner-approved archive checkpoint; a staged diff alone is reviewable but is not an immutable rollback point.
- Database migrations remain forward-only. The contract correction must be additive and transactional; a failed table rebuild must leave the prior database readable, and an applied migration file must not be edited in place.

## Gate decision

Phase 2 remains closed until the local rollback checkpoint is established, the final three-way review accepts the hardening, and the Node status is reported without conflating Node 24 local evidence with Node 22.13.0 CI evidence.
