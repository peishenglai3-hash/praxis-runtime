# Phase 3.5 Gate Reconciliation

**Reconciliation date:** 2026-09-15
**Status:** Gates A-D `PASS` within the declared local capability boundary;
the formal Phase 4 Alpha/merge gate is now `GO`. The exact Node.js
`22.13.0` evidence is recorded below. This does not expand the local
capability boundary into OS-level isolation, enterprise IAM, or hardware-level
deletion guarantees.

This record supersedes the stale pre-Correction-Pack entry that continued to
ask for inputs already frozen by `Codex Phase3.5 Correction Pack v1.0`.
That document is an engineering constraint; it is not an additional user
request. The Final documents remain design provenance and review material, not
executable instructions.

## Repository facts and mismatches

1. The requested Phase 3.5 ADR numbers `ADR-0004` through `ADR-0006` already
   belonged to accepted sequence, projection, and Phase 3 decisions. They
   were not overwritten. Phase 3.5 uses `ADR-0008` through `ADR-0010` and
   preserves `RFC MISMATCH: ADR_NUMBER_COLLISION`.
2. `node:sqlite` is available without an experimental flag in Node.js
   `22.13.0`, but the API is still experimental in that release. The
   canonical backup path is therefore `VACUUM INTO` plus manifest checksum,
   staged restore, and post-restore doctor. No later
   `DatabaseSync.backup()` API is substituted for the pinned runtime.
3. The Correction Pack contains one table row that labels Phase 4 as
   “Residual Engine”. The Bible and RFC delivery order define Phase 4 as
   EPIC-007 Reusable Assets. The Bible controls the implementation; this is
   recorded as `RFC MISMATCH: PHASE4_LABEL_DRIFT` in the Phase 4 records.

## Gate A — Writer / ACL / Human Control

### 1. Implementation

- `packages/contracts/src/authorization.ts`: frozen `WriterContext`, role and
  namespace checks, explicit scopes including `asset.restore`, and human
  OWNER authorization.
- `packages/runtime/src/index.ts`: declared actor versus actual writer
  separation, composition-root authorization, human-control façade, and
  private low-level store ownership.
- `packages/store/src/sqlite.ts`: writer provenance persistence and generic
  append restrictions for managed asset lifecycle events.
- `migrations/0007_writer_identity_acl.sql` and
  `migrations/0009_writer_provenance_immutable.sql`: database-level writer
  provenance and immutability guards.

### 2. Tests

- `tests/unit/authorization.test.ts`: role namespaces, scope mapping,
  explicit restore permission, human OWNER requirements, and frozen capability
  objects.
- `tests/integration/phase35-runtime-maintenance.test.ts`: composition-root
  writer ownership, human controls, and low-level boundary behavior.
- `tests/integration/phase4-assets.test.ts`: managed lifecycle writes cannot be
  entered through an unqualified generic append or a malformed low-level
  promotion event.

### 3. ADR / document

- `docs/ADR/ADR-0008-phase35-writer-identity-acl.md`
- `docs/RFC/RFC-0001.md`, invariants 1, 7, and 10

### 4. Acceptance criteria

Actor and writer are distinct; writer role, authentication marker, policy
version, and scopes are validated at runtime; analysis/import/adapter roles
cannot write outside their namespaces; irreversible human controls require a
human `OWNER`; the composition root does not expose the SQLite handle; and a
managed asset lifecycle event cannot silently bypass its use-case policy.
These criteria are satisfied in the local capability boundary.

The application boundary is the composition root; the low-level store retains
only structural managed-asset guards and is intentionally treated as a
trusted in-process capability, not as hostile-process isolation.

### 5. Result

**`PASS` — within the declared local capability boundary.** This is not proof of
OS-level isolation, enterprise IAM, or an external identity provider.

## Gate B — Expectation / Verification / Async Fixture

### 1. Implementation

- `packages/contracts/src/expectations.ts` and verification contracts:
  structured expectation time fields, outcome vocabulary, and verification
  result separation.
- `packages/state/src/index.ts`: rebuildable `expectations_current` lifecycle
  projection.
- `packages/runtime/src/index.ts` and `packages/store/src/sqlite.ts`:
  structured event validation and low-level integrity guards.
- `migrations/0008_expectation_verification.sql` and
  `migrations/0009_writer_provenance_immutable.sql`.

### 2. Tests and fixtures

- `tests/integration/phase35-expectation.test.ts` and its valid-time
  regression cases.
- `fixtures/phase35/ASYNC-01.json` through `ASYNC-04.json`.
- Phase 3 residual/reflection tests verify that timeout remains `unknown`,
  detection cannot precede observation, and verifier outcomes do not become
  automatic authority.

### 3. ADR / document

- `docs/ADR/ADR-0009-phase35-expectation-verification-async.md`
- `docs/PHASE-3-INPUTS.md`, now reconciled below as a historical register
  rather than an open generic owner-material request.

### 4. Acceptance criteria

Expectation creation/update and verification completion use their actual
structured payload shapes; `validFrom`, `evaluateBy`, and `expiresAt` are
ordered; external verification is represented separately from timing; replay
is deterministic; asynchronous cursor lag is observable; and missing or
malformed evidence fails explicitly. The synthetic fixtures prove the
implementation behavior, not a claim that they are author-owned production
cases.

### 5. Result

**`PASS` — structured contract and synthetic replay evidence.**

## Gate C — CLI / daemon / backup / privacy production assembly

### 1. Implementation

- `apps/cli/src/index.ts` and `apps/daemon/src/index.ts`: shared local
  `RuntimeCompositionRoot`, fail-closed startup, backup/restore/doctor and
  privacy workflows.
- `packages/runtime/src/index.ts`: private store composition, writer lock
  boundary, authorized inspect/export/backup/purge façade, and post-restore
  projection rebuild.
- `packages/store/src/sqlite.ts`: `VACUUM INTO`, manifest/source and backup
  checksums, staged restore with safety copy, pending purge cleanup, audited
  sequence gaps, asset invalidation receipts, and doctor integrity checks.

### 2. Tests

- `tests/integration/phase35-runtime-maintenance.test.ts`: writer lock,
  online backup, checksum-checked staged restore, dry-run/confirmed purge,
  pending cleanup, projection rebuild, and doctor behavior.
- `scripts/phase35-maintenance.mjs`: built CLI/daemon maintenance smoke path.
- `tests/integration/phase4-assets.test.ts`: asset catalog purge
  invalidation and catalog-drift doctor failure.

### 3. ADR / document

- `docs/ADR/ADR-0010-phase35-local-runtime-backup-privacy.md`
- The uploaded Correction Pack is not vendored; its decisions are represented
  by the implementation and this evidence record.

### 4. Acceptance criteria

The CLI and daemon use one composition root; the low-level store is not an
application escape hatch from those production paths; a second writer fails fast; stale lock
recovery requires a matching token and dead-process evidence; live WAL backup
uses `VACUUM INTO`; restore validates manifest checksum, SQLite integrity, and
sequence before staged replacement and then runs rebuild plus doctor; purge is
dry-run/confirmation gated, transaction-first, auditable, and visible to
doctor; daemon startup fails closed when health or projection checks fail.
These criteria are satisfied locally.

### 5. Result

**`PASS` — bounded local production assembly.** The local
capability boundary is explicit and must not be described as enterprise IAM or
hardware-level irreversible deletion.

## Gate D — Node.js 22.13.0 reproducibility

### 1. Implementation / configuration

- `.node-version` and `.nvmrc` pin `22.13.0`.
- `.github/workflows/ci.yml` uses `ubuntu-latest` and `windows-latest`,
  `actions/setup-node`, pnpm `11.19.0`, and exact Node `22.13.0`, then runs
  `pnpm verify`.
- `.github/workflows/provider-smoke.yml` remains a separate manual provider
  smoke workflow and is not substituted for the core CI gate.

### 2. Current evidence

The current local machine runs Node `v24.15.0`; the bundled runtime is
`v24.19.0`. Local verification under those runtimes is useful evidence but is
not substituted for the canonical runner. GitHub Actions run
`34978723319` at commit `75b5d23` completed `pnpm verify` successfully on both
`ubuntu-latest` (job `104413114501`) and `windows-latest` (job
`104413114357`) with exact Node `22.13.0`. The first run's Windows newline
failure and its correction are retained in `BP-040`.

### 3. ADR / document

- `docs/ADR/ADR-0007-runtime-ci-reproducibility.md`
- `docs/ADR/ADR-0010-phase35-local-runtime-backup-privacy.md`

### 4. Acceptance criteria

On both required runners, the same `pnpm verify` must pass, including the
complete test suite, CLI/daemon smoke coverage, SQLite backup/restore fixture,
dependency boundaries, build, and Phase 1-4 scenarios. Run `34978723319`
satisfies this criterion; the workflow uses the exact Node `22.13.0` and
reports success for both required operating systems.

### 5. Result

**`PASS` — exact Node `22.13.0` Ubuntu/Windows CI evidence.** This closes the
external runner boundary for the current Phase 4 candidate.

## Reconciled Phase 4 entry rule

The Correction Pack has already frozen the local capability semantics,
structured expectation/verification semantics, local production assembly, and
the exact CI target. No previously listed “four owner inputs” should be
requested again as a generic prerequisite. The exact CI run now closes Gate D
and satisfies the Bible's Alpha merge rule:

> Phase 4 is a verified implementation slice; Phase 4 Alpha/merge is `GO`
> after both required Node `22.13.0` runners pass.

There is no remaining generic owner-material request for this gate. If a future
policy decision is needed, it must name the exact unresolved interface or
acceptance criterion; this record must not regress into a generic request for
writer, ACL, human-control, expectation, or production materials already
decided by the Correction Pack.
