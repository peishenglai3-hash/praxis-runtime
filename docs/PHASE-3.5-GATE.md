# Phase 3.5 Gate Record

Status: implementation candidate; Gates A-C are locally verified within the
declared local trust boundary, Gate D is pending an actual Node.js `22.13.0`
runner. Phase 4 remains `NO-GO` until all four gates and the owner inputs are
closed.

## Repository reality and mismatch

The requested Phase 3.5 ADR names `ADR-0004` through `ADR-0006` collide with
already accepted repository ADRs for sequence cursors, projection boundaries,
and Phase 3 derived integrity. Those existing decisions are preserved. The
Phase 3.5 decisions use unique files `ADR-0008` through `ADR-0010`; CI remains
`ADR-0007`. This is recorded as `RFC MISMATCH: ADR_NUMBER_COLLISION` rather than
silently overwriting history.

Node 22.13.0 exposes unflagged `node:sqlite`, while its `DatabaseSync.backup()`
convenience API arrived later. The implementation uses SQLite `VACUUM INTO` as a
consistent online snapshot and records `RFC MISMATCH: SQLITE_BACKUP_API_VERSION`
as a compatibility boundary. No direct copy of a live WAL database is used.

## Gate A — Writer / ACL

Local status: `PASS` within the local capability boundary after the writer
migration, frozen role/policy checks, namespace tests, human-control guard, and
low-level append authorization tests. This is not operating-system or
enterprise identity proof.

Evidence: `packages/contracts/src/authorization.ts`, migration `0007`,
`tests/unit/authorization.test.ts`, the SQLite writer provenance integration
tests, and the Phase 3.5 runtime human-control/read-export integration tests.

## Gate B — Expectation / Verification

Local status: `PASS` for the structured contract and synthetic replay fixtures.
`expectations_current` is rebuildable; `validFrom`, `evaluateBy`, and `expiresAt`
are ordered; verifier outcomes are distinct from timing concerns; timeout is
represented as `unknown` when no external result exists.

Evidence: `packages/contracts/src/expectations.ts`, migrations `0008` and `0009`
lifecycle protection, `tests/integration/phase35-expectation.test.ts`, the explicit
`validFrom`/`expiresAt` regression, and `fixtures/phase35/ASYNC-01.json` through
`ASYNC-04.json`.

## Gate C — Production assembly

Local status: `PASS` for the bounded local assembly. The CLI and daemon use the
same `RuntimeCompositionRoot`; the low-level store is private to that root;
writer lock conflicts fail fast and stale locks require an explicit token and
dead-process check; online backup, staged manifest/checksum restore, fail-closed
daemon startup, dry-run/confirmed session purge, audited sequence gaps,
transaction-first pending-backup cleanup, invalidated asset provenance,
projection rebuild, and doctor checks have local coverage.

Evidence: `apps/cli/src/index.ts`, `apps/daemon/src/index.ts`,
`packages/runtime/src/index.ts`, `packages/store/src/sqlite.ts`, migration
`0008`/`0009`, and `tests/integration/phase35-runtime-maintenance.test.ts`. The
composition root now depends on a structural `RuntimeStore` contract, and a
confirmed purge rebuilds core projections before returning to the caller. The
asset invalidation record is deliberately receipt-based after physical purge;
whether Phase 4 should expose a separate non-content lifecycle event remains an
owner policy decision. The public runtime surface is a domain façade: the
low-level store and runtime ports are ECMAScript-private, but this remains a
trusted local-process boundary rather than OS-level isolation or enterprise IAM.

## Gate D — Reproducibility

Local status: `PENDING` for the required runner. Pins and workflows are present:
`.node-version`, `.nvmrc`, `.github/workflows/ci.yml`, and
`.github/workflows/provider-smoke.yml`. Current local verification under Node
24 is not substituted for Node 22.13.0 evidence.

## Phase 4 entry rule

Phase 4 cannot start while any gate is red or pending. The four owner input
packages also remain explicit: trusted writer/ACL and human control semantics;
author-supplied sanitized asynchronous cases plus external verification policy;
production/backup/privacy choices; and an accessible Node 22.13.0 runner or an
explicitly approved private CI/source-upload path.
