# Phase 5 Gate — EPIC-008 Legacy Migration and EPIC-009 CLI / Diagnostics

**Status:** `PASS` within the declared local capability boundary
**Formal Alpha/merge gate:** `GO` locally; the external runner gate is `PENDING`
**Controlling plan:** `Codex Implementation Bible v1.0`
**ADRs:** `docs/ADR/ADR-0012-phase5-legacy-migration.md`,
`docs/ADR/ADR-0013-phase5-cli-diagnostics.md`
**Field map:** `docs/migration/LEGACY-FIELD-MAP.md`

## Scope

This phase implements two Bible epics:

- **EPIC-008, issues 070-075** — audited Legacy migration. The first
  generation's history enters the second generation as auditable material, and
  no first-generation algorithm output is treated as fact.
- **EPIC-009, issues 080-086** — the local control surface a person, an
  automation, and another model can all use: composition root, `init`/`doctor`,
  event/state/rebuild, context/residual/reflection, asset, legacy, and
  privacy/export commands.

Phase 5 begins from the Phase 4 checkpoint `15f6e2f`. Per `docs/HANDOFF.md` it
does not modify `main`, does not force-push, and does not widen Bible scope
silently: every departure from the Bible text is recorded as an `RFC MISMATCH`
in `docs/RFC/RFC-0001.md` with its decision owner.

## Acceptance review — EPIC-008

| Issue | Acceptance condition                                                                                     | Evidence                                                                                                  | Result         |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| 070   | Recognises signals/patterns/graph/index/state; produces source inventory with `sha256`.                  | `packages/runtime/src/legacy/scanner.ts`; `migrations/0011_legacy_import.sql` (`legacy_source_inventory`) | `PASS` locally |
| 071   | Dry-run report carries parse failures, anomalies, collisions, overwrite suspicion, unrecoverable fields. | `buildLegacyMigrationPlan`; `praxis legacy import --dry-run`; `planHash` as the confirmation token        | `PASS` locally |
| 072   | Signals import as `legacy.signal.imported`; idempotent by source fingerprint.                            | `buildLegacyImportEvents`; `recordLegacyImport` (fingerprint-keyed); fingerprint/idempotency tests        | `PASS` locally |
| 073   | Patterns and graph edges import at low provenance; graph edge as `legacy.graph-edge.imported`.           | `provenance.origin = "inferred"`, pattern confidence capped at 0.5; no `asset.*` path from the importer   | `PASS` locally |
| 074   | Optional read-only archive copy of the source files with manifest and hashes.                            | `packages/runtime/src/legacy/archive.ts`; `LegacyArchiveManifest` with per-entry digest verification      | `PASS` locally |
| 075   | Migration report: import counts, anomalies, unrecoverable fields, candidate counts, re-import test.      | `LegacyMigrationReport`; `tests/integration/phase5-legacy.test.ts`; `scripts/phase5-legacy.mjs`           | `PASS` locally |

**EPIC-008 gate:** a repeated import is idempotent; no old pattern becomes
`active` automatically; information that cannot be recovered is explicitly
marked and never invented. All three hold — see "Promotion confinement" and
"Honesty constraints" below.

## Acceptance review — EPIC-009

| Issue | Acceptance condition                                                                             | Evidence                                                                                       | Result         |
| ----- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------- |
| 080   | Runtime composition root exposes a use-case API; `apps` do not compose domain packages.          | `RuntimeCompositionRoot`; `scripts/assert-*` boundary fixtures; `dependency-cruiser` config    | `PASS` locally |
| 081   | `init`/`doctor`; doctor covers DB/schema/projection/assets/cursors/context/legacy.               | `praxis init`; `praxis doctor`; `runtimeReservedEventTypes`; the doctor check list below       | `PASS` locally |
| 082   | `event`/`state`/`rebuild` support `--json` and stable exit codes.                                | `apps/cli/src/args.ts`, `output.ts`, `errors.ts`; exit-code taxonomy 0/2/3/4/5/6/7/8           | `PASS` locally |
| 083   | `context`/`residual`/`reflection` call only the runtime API; machine output is schema-versioned. | `reflectionInputForResidual`; `schemaVersion` on every `--json` document                       | `PASS` locally |
| 084   | `asset` inspect/contest/activate/disable/restore/fork plus `history explain`.                    | the asset command family; Phase 4 policy reached through the runtime, not re-implemented       | `PASS` locally |
| 085   | `legacy` import `--dry-run` / commit, with a report path.                                        | `praxis legacy import --dry-run` / `--confirm --plan-hash`; `praxis legacy runs` / `anomalies` | `PASS` locally |
| 086   | `privacy` purge impact preview plus confirm; export manifest.                                    | `praxis privacy purge --dry-run` / `--confirm`; `praxis export`; purge receipts                | `PASS` locally |

**EPIC-009 gate:** every main command has `--json`; error codes are stable; the
command line contains no duplicated business logic; `doctor` locates problems
in a deliberately damaged fixture. The last is demonstrated by
`scripts/phase5-cli.mjs`, which injects two real faults into a real store and
requires `doctor` to name both.

## Implementation evidence

### Contracts and domain

- `packages/contracts/src/legacy.ts` — inventory, anomaly, record, plan, report.
- `packages/contracts/src/legacy-events.ts` — the `legacy.*` envelope validator.
- `packages/contracts/src/authorization.ts` — `legacy.*` requires `system.migrate`.

### Runtime and persistence

- `packages/runtime/src/legacy/{parse,scanner,archive,events,fs,index}.ts`
- `packages/runtime/src/index.ts` — `Phase5Runtime`, `planLegacyImport`,
  `applyLegacyImport`, `legacyImporterWriterContext`, `runtimeReservedEventTypes`.
- `migrations/0011_legacy_import.sql` — run, inventory and anomaly tables, the
  append-only triggers, and the `legacy_event_integrity` guard.
- `packages/store/src/sqlite.ts` — `recordLegacyImport`, `getLegacyIntegrityIssues`.

### Command line

- `apps/cli/src/{index,args,config,errors,output}.ts`
- `docs/ADR/ADR-0013-phase5-cli-diagnostics.md`

### Schemas and fixtures

- `schemas/legacy-signal-imported-event.v1.schema.json`,
  `schemas/legacy-anomaly-event.v1.schema.json`,
  `schemas/legacy-migration-report.v1.schema.json`,
  `schemas/praxis-config.v1.schema.json`
- `fixtures/legacy/` — synthetic and byte-exact, generated by
  `scripts/generate-legacy-fixture.mjs`, marked `-text` in `.gitattributes` so
  Git cannot normalise the encoding facts the importer must detect.

### Tests and scenarios

- `tests/unit/legacy-scanner.test.ts`
- `tests/integration/phase5-legacy.test.ts`
- `tests/integration/phase5-cli.test.ts`
- `tests/integration/phase5-review-fixes.test.ts`
- `scripts/phase5-legacy.mjs` + `scripts/phase5-legacy-worker.mjs`
- `scripts/phase5-cli.mjs`

## Honesty constraints

These are the constraints the phase is measured against, and how each is met.

1. **No fabricated history repair.** `possible_overwrite` reports only the
   provable fact — how many ordinal values _inside the range a bucket actually
   occupies_ are unused. A bucket whose ordinals simply start above one is not
   flagged, because that is equally consistent with a counter that carried
   across a boundary. Destroyed pattern instances are counted, never
   re-derived.
2. **Absence is recorded as absence.** The six theory fields the writer
   declared but never persisted are listed in each record's `absentFields`, and
   the four index fields that fall back to a default are named there too — so
   nothing a reader sees can be mistaken for a recorded value.
3. **A missing instant is not invented.** A declared timestamp without its own
   zone designator is refused and the record excluded, because `Date.parse`
   would resolve it against the reading host and the same bytes would name
   different instants on different machines.
4. **Promotion confinement.** The importer's writer is the frozen `IMPORTER`
   role: namespace `legacy.*` only, holding no `asset.*` scope. A
   first-generation pattern enters the ledger as inferred material with
   confidence capped at 0.5. Turning it into a candidate asset is a separate,
   explicit runtime step that must satisfy the Phase 4 promotion policy and
   human confirmation. The Bible's "旧 patterns → candidate asset，不自动
   active" is delivered as the _consequence_ of that boundary, not as an
   automatic conversion the importer performs.
5. **No claim beyond evidence.** Anomaly rows name their evidence; an anomaly
   about the corpus as a whole cites the corpus fingerprint, and one about a
   single file cites that file's digest. If it cannot cite something real, the
   import refuses rather than writing a placeholder.

## Security and permission review

| Boundary                | Control                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                   | `legacy.*` requires `system.migrate` — the scope the migration boundary already reserved — not the generic append scope.                                                      |
| Writer kind             | The trigger admits `IMPORTER` and `OWNER` roles only, and refuses any unknown `legacy.*` verb.                                                                                |
| Provenance              | Fixed per event family by both the validator and the trigger; a caller cannot choose it.                                                                                      |
| Identity                | `legacyEventId` is a deterministic hash over the event payload, so a retry is idempotent at the ledger boundary.                                                              |
| Privacy exclusions      | A matched path is **excluded** from every extracted family, not merely reported; a declared rule that matched nothing is reported too.                                        |
| Purge                   | Purge receipts are respected: doctor does not report an operator's exercised deletion right as an integrity failure.                                                          |
| Archive location        | The archive must be outside a Git working tree; the command refuses a path inside one rather than warning.                                                                    |
| Archive integrity       | Every entry is verified against the digests the plan was derived from; a mismatch refuses the write.                                                                          |
| Irreversible operations | `--dry-run` together with `--confirm` is refused; a confirmed import requires the reviewed plan hash; a restore that fails its doctor gate is rolled back to the safety copy. |

The low-level store and the importer's writer context remain trusted in-process
capabilities. They enforce structural integrity and the frozen writer scopes,
but they are **not** an OS-level hostile-process boundary. These are local
capability and integrity controls; they do not claim OS-level process
isolation, enterprise identity, or hardware-level irreversible deletion.

## Complex-environment test

Two scenarios run under `pnpm verify`, both in real processes against a real
SQLite store rather than in-process fakes:

1. **`pnpm phase5:scenario`** — four independent worker processes import the
   same corpus concurrently. Expected: exactly one run wins, the losers report
   `already-imported` with no duplicate events, and the reopened database passes
   `doctor` after the projections are caught up.
2. **`pnpm phase5:cli`** — drives the built command line the way an operator
   would: `init`, `doctor`, a dry run, a confirmed import, and `doctor` again.
   Two faults are deliberately injected into the store, and `doctor` must
   locate **both** by name.

These scenarios are what the process requirement is for: the projection-lag
defect recorded as `BP-046` was found by the second scenario and by no unit or
integration test, because those call the runtime directly instead of following
the operator's "write, then look" sequence.

## Review round

Two independent reviews were run against the phase's new results — one for
engineering adaptability, developability and usability, and one for
intellectual compliance. Both found real defects; the High findings were fixed
with regression tests, and the remainder were fixed or recorded. The
regressions live in `tests/integration/phase5-review-fixes.test.ts`, each named
after the behaviour that was wrong.

| Defect found                                                                                                      | Disposition                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A timestamp with no zone designator was resolved against the host clock.                                          | Refused: a zone designator is now required, and the record is excluded and counted.         |
| Fields that fell back to a default were imported under `declared` provenance with no record of the default.       | Every defaulted field is named in `absentFields`; the source default is `"undeclared"`.     |
| Privacy rules were reported as matching but did not actually exclude material.                                    | Rules now exclude what they match, and a rule matching nothing is reported.                 |
| Idempotency keyed on `(fingerprint, plan_hash)` collided with the corpus's own records when the rule set changed. | Keyed on the fingerprint alone; a plan difference is reported as `planDiffersFromRecorded`. |
| Purge made `doctor` report a permanent integrity failure.                                                         | The integrity check is purge-receipt-aware.                                                 |
| An anomaly with no artifact in the inventory fabricated a zero digest.                                            | It throws; a corpus-level anomaly cites the corpus fingerprint.                             |
| The archive could be written inside a Git working tree.                                                           | Refused with `CONFIG_ERROR`.                                                                |
| An unknown command-line flag was silently ignored.                                                                | Flags are validated per command; an unknown flag is a usage error.                          |
| `--archive=` (empty value) resolved to the process working directory.                                             | An empty flag value counts as absent.                                                       |
| A fixed safety-backup name blocked the second restore.                                                            | The safety copy is unique per restore, and is rolled back from on failure.                  |

Three findings were escalated to the owner rather than fixed unilaterally:

- **`BP-047`** — a managed backup's snapshot carries its own unfinalized
  reservation row, whose digest is not recorded until after the snapshot
  exists. Pre-existing (the managed-backup design comes from ADR-0010), and it
  made every managed restore fail its own doctor gate. **Owner decision:
  correct the doctor's classification.** An active row with no digest is no
  longer compared as a checksum; an absent digest and a wrong digest are
  different conditions, and only the second is evidence that a backup file
  changed. The state is still disclosed, as
  `managedBackups.unfinalizedReservations`, and a new regression test tampers
  with a backup file to prove the check keeps its teeth. Both restores in the
  test now exit `0`, where before the fix both exited `5`.
- **`BP-048`** — a committed migration file is content-addressed, so its
  comments are frozen too and cannot be corrected in place without invalidating
  every existing database. Two statements in `0011` are stale; the corrections
  live in ADR-0012 §5.1.
- **`BP-049`** — two build steps write the same `dist/`. `pnpm build` (tsup)
  emits a bundled `dist/index.d.ts`; `pnpm typecheck` (`tsc --build`) emits
  per-file declarations and, incrementally, does not rewrite the file tsup
  bundled. Because `pnpm verify` runs `typecheck` and `test` **before**
  `build`, a package type change can make typecheck fail against correct code,
  and a bare `npx vitest run` can test — or pass against — stale code. CI is
  unaffected (a clean checkout forces a full emit); it is a local-iteration
  hazard. Not fixed: changing it means changing what `pnpm verify` is, which is
  the owner's call. Candidate fixes are in the breakpoint entry.

## Known deviations recorded rather than closed

1. **`OPEN GAP: CONFIGURATION_SURFACE`** — Bible section 13.2 names four knobs
   as operator configuration. One is delivered and three are not:

   | §13.2 knob                 | State                                                                                                                                                    |
   | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | promotion threshold        | **Delivered.** `praxis.config.json` carries `promotionPolicy.minimumEvidence` and `minimumIndependentEpisodes`, validated and threaded into the runtime. |
   | context-ranking weights    | Not delivered. Package defaults.                                                                                                                         |
   | reflection budgets         | Not delivered. Package defaults.                                                                                                                         |
   | timing-residual thresholds | Not delivered. Package defaults.                                                                                                                         |

   `praxis.config.json` itself exists, is versioned, strict about unknown
   fields, and secret-free; it also carries the data directory, migrations and
   backups directories, the legacy archive root, the legacy privacy rules, and
   the actor/writer identity. Threading the remaining three would change the
   verified Phase 3 and Phase 4 constructor boundaries, so it is named as a gap
   rather than done quietly. Decision owner: the repository owner.

2. **`RFC MISMATCH: LEGACY_INPUT_NOT_IN_REPOSITORY`** — the Bible names the
   owner's own history as the migration input, and this repository holds
   neither the source nor the data. The fixture is synthetic. Decision owner:
   the repository owner.
3. **`RFC MISMATCH: LEGACY_ANOMALY_CLASSES_EXTENDED`** — the Bible's section 12
   table has five rows: four name a class, the fifth describes a cartesian
   relation without naming one. Four further classes are implemented because
   the corpus exhibits conditions the table cannot express. Decision owner: the
   repository owner.
4. **Stale text inside the frozen migration `0011`** — the trigger comment's
   "deterministic identity" claim and the header's `(source_fingerprint,
plan_hash)` idempotency claim. Cannot be corrected in place (`BP-048`); the
   correct statements are in ADR-0012 §5.1.

## Verification

`pnpm verify` runs format, lint, workspace dependency direction, the
`dependency-cruiser` boundary checks (including the positive and negative
fixtures), typecheck, the test suite, build, schema parity, and the Phase 1-5
scenarios. Its result for this checkpoint is recorded in the commit message and
in `docs/HANDOFF.md`.

The exact Node `22.13.0` runner evidence for this checkpoint does **not** exist
yet. Local verification has been performed on Node 24, which is development
evidence and is **not** substituted for Node 22 runner evidence — the same
runner boundary Gate D closed for Phase 4. Until a CI run on exact Node
`22.13.0` passes on `ubuntu-latest` and `windows-latest`, this phase is a local
`PASS` and not a closed gate.

`node:sqlite` remains experimental in Node `22.13.0` even though the flag is no
longer required. `VACUUM INTO` remains the pinned backup path for that
baseline.

## Three-way review

Read together: the Bible (the controlling engineering plan), the two _The
Final_ theory documents (the intellectual provenance and review constraint),
and `docs/断点记录.md` (this project's own record of where it broke). The
review asks one question of the phase: do the three agree about what was built,
and where do they disagree, what is the viable correction direction?

### 1. Bible — where the implementation is measured

| Bible requirement                                                                      | Where it lands                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| §12: the migration must not pretend the history is fully recoverable                   | `possible_overwrite` reports only unused ordinals inside an observed range; destroyed patterns are counted, never re-derived. |
| §12: recover each source file's path, size, mtime, sha256, parse status, anomaly flags | `legacy_source_inventory`, one row per file, plus the qualified anomaly join.                                                 |
| §12: repeated import of one source fingerprint is idempotent                           | Fingerprint-keyed; verified by a four-process concurrent scenario.                                                            |
| §12: no old pattern becomes `active` automatically                                     | The importer's `IMPORTER` role holds no `asset.*` scope at all, so this is structural rather than a rule it follows.          |
| §12: `--dry-run` first, then commit                                                    | `planHash` is the confirmation token; committing requires presenting the hash of the plan that was reviewed.                  |
| §13: exit codes, `--json`, stderr diagnostics                                          | Exit-code taxonomy, one versioned machine document on stdout, every diagnostic on stderr.                                     |
| §13.1: doctor covers legacy import manifest and anomaly status                         | The `legacy-import-integrity` check, now purge-receipt-aware.                                                                 |

Departures are recorded, not absorbed: `LEGACY_INPUT_NOT_IN_REPOSITORY`,
`LEGACY_ANOMALY_CLASSES_EXTENDED`, `OPEN GAP: CONFIGURATION_SURFACE`.

### 2. The Final — the constraint the phase is judged by

The theory's relevant claim is that material must be kept precisely where the
process was _folded closed_, so that a later reader can reopen it: the record
of how something became a fact is not the same object as the fact, and it is
the first that is irreplaceable. It also insists that difference produces
mismatch, mismatch produces breakpoints, and breakpoints are what reflection is
made of — a frictionless record produces no reflection at all.

The phase's answers to that constraint:

- the ledger is append-first and a correction is a new run, never an edit, so
  the process stays reopenable;
- an anomaly is recorded as an observation about the source, with `direct`
  provenance, and is never a repaired value — the repair is what would fold the
  process closed;
- the six theory fields the first-generation writer declared but never
  persisted are carried as `absentFields` on every record, and the four
  defaulted index fields are named there too, so what is _not_ present cannot be
  read as present;
- the exclusion of a privacy-matched record is counted and reported rather than
  silently dropped, because a silent omission reads as "nothing was there".

Where the theory constrains the phase rather than being served by it: the
archive and the report are evidence about the _source_, not about the owner.
The migration makes no claim about what the history means — only about what the
bytes say. That limit is the honest one, and it is stated in the field map's
non-goals.

### 3. `docs/断点记录.md` — what this project broke on, and what that is for

| Entry  | What it records                                                                               | Status                                     |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| BP-043 | the Phase 5 legacy audit and its quantified findings                                          | recorded                                   |
| BP-044 | the toolchain materialising escape sequences as real control bytes in source                  | fixed; a byte-scan guard added             |
| BP-045 | three real implementation defects (path mismatch, anomaly id collision, append-only conflict) | fixed                                      |
| BP-046 | write paths did not converge derived state, found by the real-process scenario                | fixed                                      |
| BP-047 | a managed backup's snapshot carries its own unfinalized reservation                           | fixed (owner decision: reclassify)         |
| BP-048 | a committed migration is content-addressed, so a comment edit breaks every database           | avoided; correction moved to ADR-0012 §5.1 |
| BP-049 | two build steps write one `dist/`, so local iteration can test stale code                     | open — changes what `pnpm verify` is       |

The two most useful entries are BP-047 and BP-049, because neither is a coding
mistake: BP-047 crosses an ADR-frozen boundary, and BP-049 is a defect in the
**verification apparatus itself** — the thing that tells you whether anything
else is right. BP-048 crosses the boundary of what a frozen artefact can be
edited to say. All three were surfaced rather than worked around, which is the
behaviour the process requirement exists to produce.

### Viable correction directions

1. **BP-049 changes what `pnpm verify` means, so it needs an owner decision
   rather than a quiet reorder.** Recommended: move `pnpm build` ahead of
   `pnpm test` in the `verify` script, so the tests exercise the build that this
   run produced. The alternative — aliasing every workspace package to `src` in
   `vitest.config.mjs`, as `@praxis/contracts` already is — removes the
   dual-writer mismatch entirely but changes the object under test from built
   artefacts to sources.
2. **The three undeclared §13.2 knobs** (context-ranking weights, reflection
   budgets, timing-residual thresholds) stay named gaps until the owner decides
   whether to thread them through the Phase 3/4 constructor boundaries. Owner
   decision taken: keep them named.
3. **`promotionPolicy` is already delivered** and should no longer be counted
   as a gap — corrected here and in `docs/RFC/RFC-0001.md` during this review.
4. **The external runner evidence** is the only remaining formal gate. It is
   the same boundary Gate D closed for Phase 4, and it requires a push.
   **Owner decision taken: do not push yet**, so this gate stays `PENDING` and
   Phase 5 remains a local `PASS` rather than a closed gate.

## Formal gate result

**Phase 5 local implementation:** `PASS` within the bounded capability
boundary.
**Phase 5 Alpha/merge:** `GO` locally, pending the external runner evidence
above.

## Rollback point

The Phase 5 work is kept in ordinary, reversible commits on `phase5/legacy-cli`
after verification. Nothing is pushed without explicit owner authorization.
If a future change conflicts with this gate, stop, record the requested state,
the observed state, the impact, the evidence and the decision in
`docs/断点记录.md`, and report an `RFC MISMATCH` instead of silently widening
the scope.
