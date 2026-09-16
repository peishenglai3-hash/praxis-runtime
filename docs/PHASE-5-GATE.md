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

| Issue | Acceptance condition                                                                                     | Evidence                                                                                                                                                                                                                                                                                                         | Result         |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 070   | Recognises signals/patterns/graph/index/state; produces source inventory with `sha256`.                  | `packages/runtime/src/legacy/scanner.ts`; `migrations/0011_legacy_import.sql` (`legacy_source_inventory`)                                                                                                                                                                                                        | `PASS` locally |
| 071   | Dry-run report carries parse failures, anomalies, collisions, overwrite suspicion, unrecoverable fields. | `buildLegacyMigrationPlan`; `praxis legacy import --dry-run`; `planHash` as the confirmation token                                                                                                                                                                                                               | `PASS` locally |
| 072   | Signals import as `legacy.signal.imported`; idempotent by source fingerprint.                            | `buildLegacyImportEvents`; `recordLegacyImport` (fingerprint-keyed); fingerprint/idempotency tests                                                                                                                                                                                                               | `PASS` locally |
| 073   | Patterns and graph edges import at low provenance; graph edge as `legacy.graph-edge.imported`.           | `provenance.origin = "inferred"`, pattern confidence capped at 0.5, and no `asset.*` scope is reachable from the importer's writer. The Bible's 「旧 patterns → candidate asset」 is **not** implemented; it is registered as `RFC MISMATCH: LEGACY_PATTERN_TO_CANDIDATE_ASSET` rather than argued as delivered. | `PARTIAL`      |
| 074   | Optional read-only archive copy of the source files with manifest and hashes.                            | `packages/runtime/src/legacy/archive.ts`; `LegacyArchiveManifest` with per-entry digest verification                                                                                                                                                                                                             | `PASS` locally |
| 075   | Migration report: import counts, anomalies, unrecoverable fields, candidate counts, re-import test.      | `LegacyMigrationReport`; `tests/integration/phase5-legacy.test.ts`; `scripts/phase5-legacy.mjs`                                                                                                                                                                                                                  | `PASS` locally |

**EPIC-008 gate:** a repeated import is idempotent; no old pattern becomes
`active` automatically; information that cannot be recovered is explicitly
marked and never invented. All three hold — see "Promotion confinement" and
"Honesty constraints" below.

## Acceptance review — EPIC-009

| Issue | Acceptance condition                                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                       | Result         |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 080   | Runtime composition root exposes a use-case API; `apps` do not compose domain packages.          | `RuntimeCompositionRoot`; `scripts/assert-*` boundary fixtures; `dependency-cruiser` config                                                                                                                                                                                                                                                                                    | `PASS` locally |
| 081   | `init`/`doctor`; doctor covers DB/schema/projection/assets/cursors/context/legacy.               | `praxis init`; `praxis doctor` covers DB state, WAL/PRAGMA, projections, assets, legacy import integrity and config. It does **not** cover schema files, agent cursors or context orphans — registered as `RFC MISMATCH: DOCTOR_COVERAGE_VS_13_1`, not claimed here. An earlier version of this row cited "the doctor check list below"; no such list exists in this document. | `PARTIAL`      |
| 082   | `event`/`state`/`rebuild` support `--json` and stable exit codes.                                | `apps/cli/src/args.ts`, `output.ts`, `errors.ts`; exit-code taxonomy 0/2/3/4/5/6/7/8                                                                                                                                                                                                                                                                                           | `PASS` locally |
| 083   | `context`/`residual`/`reflection` call only the runtime API; machine output is schema-versioned. | `reflectionInputForResidual`; `schemaVersion` on every `--json` document                                                                                                                                                                                                                                                                                                       | `PASS` locally |
| 084   | `asset` inspect/contest/activate/disable/restore/fork plus `history explain`.                    | the asset command family; Phase 4 policy reached through the runtime, not re-implemented                                                                                                                                                                                                                                                                                       | `PASS` locally |
| 085   | `legacy` import `--dry-run` / commit, with a report path.                                        | `praxis legacy import --dry-run` / `--confirm --plan-hash`; `praxis legacy runs` / `anomalies`                                                                                                                                                                                                                                                                                 | `PASS` locally |
| 086   | `privacy` purge impact preview plus confirm; export manifest.                                    | `praxis privacy purge --dry-run` / `--confirm`; `praxis export`; purge receipts                                                                                                                                                                                                                                                                                                | `PASS` locally |

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

| Boundary                | Control                                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                   | `legacy.*` requires `system.migrate` — the scope the migration boundary already reserved — not the generic append scope.                                                                                                                                                                                        |
| Writer kind             | The trigger admits `IMPORTER` and `OWNER` roles only, and refuses any unknown `legacy.*` verb.                                                                                                                                                                                                                  |
| Provenance              | Fixed per event family by both the validator and the trigger; a caller cannot choose it.                                                                                                                                                                                                                        |
| Identity                | `legacyEventId` is a deterministic identity derived from the event payload — a canonical escaped composite of the family and record identifiers, **not** a hash — so a retry is idempotent at the ledger boundary.                                                                                              |
| Privacy exclusions      | A matched path is **excluded** — from every extracted family _and_ from the archive copy — not merely reported; a declared rule that matched nothing is reported too. Until 2026-09-16 the archive copied excluded bytes verbatim, which made the exclusion nominal (`BP-050`); a regression test now holds it. |
| Purge                   | Purge receipts are respected: doctor does not report an operator's exercised deletion right as an integrity failure.                                                                                                                                                                                            |
| Archive location        | The archive must be outside a Git working tree. The check runs where the archive is **written**, not while resolving paths: applied eagerly it made every command, `doctor` included, fail inside any Git working tree. The dry run writes nothing and is therefore not refused.                                |
| Archive integrity       | Every entry is verified against the digests the plan was derived from; a mismatch refuses the write.                                                                                                                                                                                                            |
| Irreversible operations | `--dry-run` together with `--confirm` is refused; a confirmed import requires the reviewed plan hash; a restore that fails its doctor gate is rolled back to the safety copy.                                                                                                                                   |

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
   `already-imported`, and the reopened database holds exactly one run, exactly
   the ledger counts that run declares, and no legacy integrity issue. The
   workers reach `store.recordLegacyImport` directly rather than going through
   `applyLegacyImport`, so **this scenario is a concurrency and ledger-integrity
   check and is not a `doctor` check**; an earlier version of this paragraph
   claimed it reopened the database and passed `doctor` after catching up
   projections, which the script does not do. The `doctor`-after-import path is
   covered by the second scenario, which drives the real command line.
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
5. **`RFC MISMATCH: LEGACY_PATTERN_TO_CANDIDATE_ASSET`** — the Bible requires
   「旧 patterns → candidate asset」; the importer emits `legacy.pattern.imported`
   and creates no candidate asset, because its frozen `IMPORTER` writer holds no
   `asset.*` scope. Previously argued in prose as "the consequence of that
   boundary"; now registered, because prose is not a registration. Issue 073 is
   marked `PARTIAL` above.
6. **`RFC MISMATCH: GOLDEN_FIXTURE_01_ABSENT`** — Bible section 14's Golden
   Fixture 01 does not exist. It cannot be synthesised without inventing the
   author's history, and the Bible's own instruction for this case is
   「素材不足 → 请求补素材」, so it is requested rather than fabricated. Blocks
   Alpha exit criterion 11. Decision owner: the repository owner.
7. **`RFC MISMATCH: DOCTOR_COVERAGE_VS_13_1`**, **`CLI_SURFACE_GAPS_VS_13`** and
   **`TEST_LAYER_STRUCTURE`** — doctor's coverage against section 13.1 (schema
   files, agent cursors, context orphans, migration compatibility,
   `integrity_check`), the section 13 CLI surface (`rebuild --projection`,
   `privacy purge <scope>`, legacy `report path`), and the frozen four test
   layers. Registered in `docs/RFC/RFC-0001.md`; issue 081 is marked `PARTIAL`
   above.

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

### 2. The Final — the constraint, and where this phase does not meet it

The constraint is drawn from three author-supplied documents, registered with
their fingerprints in `docs/SOURCE-MANIFEST.md`. The third,
`The_Final_补充性扬弃Ⅱ` (2026-09-14), was written before this phase was
implemented and was **not read until 2026-09-16**. It supersedes the
formulation this section previously used, so the earlier text is replaced
rather than kept beside it — the two say different things and only one of them
is current.

Material status is marked, because the author's own rule requires direct
wording, reconstruction across documents, and this repository's proposal to
stay separable: `[direct]` is the author's wording, `[reconstruction]` is a
reading assembled across the documents, `[proposal]` is this repository's.

**The chain.** `[direct]` 「断点不会自动进入反思」 — a breakpoint does not
automatically enter reflection. The third document therefore puts a longer
chain in place of the older 错配 → 断点 → 反思: `[direct]`

```
错配 → 潜在断点 → 断点识别条件 → 主体是否识别 → 反思
```

and names the reason: `[direct]` 「反思性，特别是人的主动反思性，在交互过程中
的异质化倾向」 — reflexivity is not a uniform human attribute but is produced
by education, resources, organisation and social position. `[direct]`
「换句话说，大部分人如果缺少外部物质性或者约束条件，在刚刚是不可能出现转化
的。」

**The self-confirmation constraint.** `[direct]` 「如果我看到差异就叫错配，看到
失败就叫断点，看到技术参与就叫 Agent，看到规则变化就叫隐性制度，那么 The
Final 一样会变成一个永远赢的理论。一个任何材料都只能证明它正确的开放理论，
本质上已经闭源了。」 This is a constraint on the _verification apparatus_, not
only on the theory.

**What the phase still answers.** `[direct]` 「必须保留完整的人机互动档案……
档案可以重新打开已经被'搞定了'折叠掉的过程」 — the ledger is append-first and a
correction is a new run, never an edit, so a folded process stays reopenable.
An anomaly is recorded as an observation about the source with `direct`
provenance and is never a repaired value, because the repair is what folds the
process closed. The six theory fields the first-generation writer declared but
never persisted are carried as `absentFields` on every record, and the four
defaulted index fields are named there too, so what is _not_ present cannot be
read as present. A privacy-matched path is counted and reported rather than
silently dropped, because a silent omission reads as "nothing was there".

**Where the phase does not meet the constraint — recorded, not absorbed.**

1. **The review the third document names actually happened to this phase.**
   The earlier version of this section asserted the superseded chain and then
   used it to support four answers that all confirmed the implementation; it
   cited no document and no line, and produced no correction. That is the shape
   `[direct]` 「一个永远赢的理论」 describes, occurring in the phase record
   itself rather than in the theory.
2. **The identification conditions were never asked.** The chain's new middle
   term — _who can see a breakpoint, and with what resources_ — has no
   corresponding question anywhere in Phase 5. The migration routed every
   theory-facing judgement through one owner reviewing two reports; what that
   apparatus structurally cannot see was not asked.
3. **The privacy exclusion was nominal until 2026-09-16.** A rule that removed
   a path from the ledger while the archive copied the same bytes is a control
   that reports itself without operating. `[reconstruction]` This is the
   engineering form of 「看到差异就叫错配」: naming an exclusion is not
   excluding. It is fixed, and the fix is covered by a regression test.

**The limit that is still the honest one.** `[proposal]` The archive and the
report are evidence about the _source_, not about the owner. The migration
makes no claim about what the history means — only about what the bytes say.
That limit is stated in the field map's non-goals.

### 3. `docs/断点记录.md` — what this project broke on, and what that is for

| Entry  | What it records                                                                                                      | Status                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| BP-043 | the Phase 5 legacy audit and its quantified findings                                                                 | recorded                                       |
| BP-044 | the toolchain materialising escape sequences as real control bytes in source                                         | fixed; a byte-scan guard added                 |
| BP-045 | three real implementation defects (path mismatch, anomaly id collision, append-only conflict)                        | fixed                                          |
| BP-046 | write paths did not converge derived state, found by the real-process scenario                                       | fixed                                          |
| BP-047 | a managed backup's snapshot carries its own unfinalized reservation                                                  | fixed (owner decision: reclassify)             |
| BP-048 | a committed migration is content-addressed, so a comment edit breaks every database                                  | avoided; correction moved to ADR-0012 §5.1     |
| BP-049 | two build steps write one `dist/`, so local iteration can test stale code                                            | open — changes what `pnpm verify` is           |
| BP-050 | the phase was implemented without reading the Bible; a third author document went unregistered; six defects followed | fixed; departures registered as `RFC MISMATCH` |

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
