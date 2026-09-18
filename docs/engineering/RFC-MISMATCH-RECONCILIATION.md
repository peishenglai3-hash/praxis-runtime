# RFC Mismatch Reconciliation — `praxis-runtime`

**Date:** 2026-09-18
**Subject:** every label registered in the mismatch registry of `docs/RFC/RFC-0001.md`
**Sources:** `docs/RFC/RFC-0001.md` (516 lines), `docs/engineering/_INVENTORY-RAW.md` Part 2, `docs/断点记录.md` (1630 lines), the ADRs and gate documents cited per entry, and `docs/release/PRE-RELEASE-GAP-MAP.md` for the release-impact categories.

## What this document is

One entry per registered mismatch, carrying the five fields the owner's brief §11 requires: **Status**, **Owner**, **Decision**, **Evidence**, **Release impact**. Twenty-four rows: twenty-three labels spelled `RFC MISMATCH:` plus one, `OPEN GAP: CONFIGURATION_SURFACE` (`docs/RFC/RFC-0001.md:187`), registered in the same list but not spelled that way. Both are carried at their RFC line.

`OWNER` is `author` where a decision belongs to the repository owner and `engineering` where the RFC or an ADR has already decided a technical matter.

`RELEASE IMPACT` names what the entry's subject still gates, as of 2026-09-18. The categories are the ones `docs/release/PRE-RELEASE-GAP-MAP.md:36-95` uses under the owner's Phase 6V brief §20 — `Blocks Phase 6 Final`, `Blocks Pre-Release Compatibility Audit`, `Blocks Release Engineering`, `Blocks Alpha`, `Future Improvement` — and where that document classifies the same item, this one follows it rather than assigning its own: `FIELD_CONTEXT_SOCIAL_PLURALITY` is `Future Improvement` there (`:95`) and `ADAPTER_EXECUTION_CONTEXT_VS_10_2` is a blocker for a §14 item, which the same document places among Release Engineering's work (`:116`, `:129-131`). Where a gate is stated only in the RFC, the gate document or an ADR, it is cited. Where no document names a gate and the assignment is this document's reading, the cell is marked `(read)`. `None` means the entry gates nothing: it is settled, or it is a document-level matter with no gate attached. `Future Improvement` is a known cost carried forward with no gate — the sense of `docs/PHASE-6-GATE.md:78-81`, "Open items carried forward… None blocks Phase 6B from a Bible-conformance standpoint".

## Re-entry addendum — 2026-09-18

The registry remains a historical record; this addendum prevents the control
plane from remaining stale after the re-entry changes:

- `LEGACY_PATTERN_TO_CANDIDATE_ASSET` is **RESOLVED**, using the author's
  frozen Option B: importer authority stays confined and the explicit human-run
  `legacy convert` path proposes a candidate. It is not an unresolved choice.
- `CLI_SURFACE_GAPS_VS_13` remains **NEEDS-EVIDENCE**. Rebuild projection
  routing and legacy report output paths now exist and have tests. The remaining
  compatibility question is the privacy-purge positional scope, so this row is
  not silently closed.
- `GOLDEN_FIXTURE_01_ABSENT` remains **BLOCKING / WAITING_FOR_AUTHOR_SOURCE**;
  the bounded source map is `docs/eval/GF01-SOURCE-MAP.md`.
- BP-049 remains **ACTIVE** because no authoritative author decision was found
  in this round. The machine audit validates this state rather than inferring a
  decision.

The repository's original mismatch prose is preserved below as historical
evidence; current control-plane interpretation is stated here and in the
corresponding RFC addendum.

## What this document is not

It is not a re-audit of the runtime against the Bible. It is not an amendment to `RFC-0001.md`: no registry entry was closed, re-spelled, or edited. It is not a gate, and it closes nothing. Where the documents say an item is open, it is reported open even where the entry could be read as settled — and where a status could not be settled from the documents, the row is `NEEDS-EVIDENCE` with the evidence that would settle it named, not upgraded so the table reads better.

## Summary

| label                                                    | status             | owner       | release impact                                |
| -------------------------------------------------------- | ------------------ | ----------- | --------------------------------------------- |
| `RFC MISMATCH: PHASE_LABEL_DRIFT_IN_RECOVERY_PROMPT`     | NEEDS-EVIDENCE     | author      | None (read)                                   |
| `RFC MISMATCH: ADR_NUMBER_COLLISION`                     | RESOLVED           | engineering | None                                          |
| `RFC MISMATCH: SQLITE_BACKUP_API_VERSION`                | ACCEPTED-DEVIATION | engineering | None                                          |
| `RFC MISMATCH: PHASE4_LABEL_DRIFT`                       | RESOLVED           | engineering | None                                          |
| `RFC MISMATCH: ASSET_RESTORE_PERMISSION_SCOPE`           | RESOLVED           | engineering | None                                          |
| `RFC MISMATCH: LEGACY_INPUT_NOT_IN_REPOSITORY`           | RESOLVED           | author      | None                                          |
| `RFC MISMATCH: LEGACY_ANOMALY_CLASSES_EXTENDED`          | ACCEPTED-DEVIATION | author      | None                                          |
| `OPEN GAP: CONFIGURATION_SURFACE`                        | NEEDS-EVIDENCE     | author      | Future Improvement                            |
| `RFC MISMATCH: LEGACY_PATTERN_TO_CANDIDATE_ASSET`        | RESOLVED           | author      | None                                          |
| `RFC MISMATCH: GOLDEN_FIXTURE_01_ABSENT`                 | BLOCKING           | author      | Blocks Alpha                                  |
| `RFC MISMATCH: DOCTOR_COVERAGE_VS_13_1`                  | DEFERRED           | author      | Blocks Pre-Release Compatibility Audit (read) |
| `RFC MISMATCH: CLI_SURFACE_GAPS_VS_13`                   | NEEDS-EVIDENCE     | author      | Future Improvement (read)                     |
| `RFC MISMATCH: TEST_LAYER_STRUCTURE`                     | RESOLVED           | engineering | None                                          |
| `RFC MISMATCH: GOLDEN_FIXTURE_01_PHASE6_START`           | RESOLVED           | engineering | None                                          |
| `RFC MISMATCH: EVENT_TAXONOMY_VS_5_4`                    | NEEDS-EVIDENCE     | author      | Blocks Pre-Release Compatibility Audit (read) |
| `RFC MISMATCH: DOCTOR_SCOPE_VS_081`                      | DEFERRED           | author      | Blocks Pre-Release Compatibility Audit (read) |
| `RFC MISMATCH: AGENT_CURSOR_STORAGE_VS_APPENDIX_B`       | ACCEPTED-DEVIATION | engineering | None                                          |
| `RFC MISMATCH: REPOSITORY_VISIBILITY_VS_FROZEN_DECISION` | RESOLVED           | author      | None                                          |
| `RFC MISMATCH: PHASE6_DELIVERY_ORDER`                    | ACCEPTED-DEVIATION | author      | None                                          |
| `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2`        | ACCEPTED-DEVIATION | author      | Blocks Release Engineering                    |
| `RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING`             | DEFERRED           | author      | Blocks Phase 6 Final                          |
| `RFC MISMATCH: GOLDEN_FIXTURE_01_UNPLACED_IN_6V_ORDER`   | RESOLVED           | author      | Blocks Phase 6 Final                          |
| `RFC MISMATCH: FIELD_CONTEXT_SOCIAL_PLURALITY`           | RESOLVED           | author      | Future Improvement                            |
| `RFC MISMATCH: SCAFFOLD_PORTABILITY_METHOD_BROADENED`    | RESOLVED           | author      | None                                          |

Counts: 11 RESOLVED, 5 ACCEPTED-DEVIATION, 4 NEEDS-EVIDENCE, 3 DEFERRED, 1 BLOCKING; by release impact, 14 `None`, 3 `Future Improvement`, 7 carrying a gate (1 `Blocks Alpha`, 3 `Blocks Pre-Release Compatibility Audit`, 2 `Blocks Phase 6 Final`, 1 `Blocks Release Engineering`). One entry (`GOLDEN_FIXTURE_01_ABSENT`) is BLOCKING and carries a gate; six of the non-BLOCKING rows do — three because a document states it (`SCAFFOLD_PORTABILITY_PENDING` and `GOLDEN_FIXTURE_01_UNPLACED_IN_6V_ORDER` at Phase 6 Final, `ADAPTER_EXECUTION_CONTEXT_VS_10_2` at Release Engineering) and three as this document's reading.

---

## Registrations carried in `## Known mismatches and resolutions` (RFC-0001.md:157-193)

### `RFC MISMATCH: PHASE_LABEL_DRIFT_IN_RECOVERY_PROMPT`

- **Status:** NEEDS-EVIDENCE
- **Owner:** author
- **Decision:** Not decided. The audit itself was re-keyed to the Bible's phase numbering (`docs/incidents/INC-001-bible-conformance-audit.md:32-36`, "Resolution taken"), and the prompt's own headings were never corrected; the RFC names the owner and records no terminal statement.
- **Evidence:** `docs/RFC/RFC-0001.md:144-155`; `docs/incidents/INC-001-bible-conformance-audit.md:14-36` (the offset table: the prompt's "Phase 3" is Bible Phase 2's context work, "Phase 4" is Phase 3's residual work, "Phase 5" is Phase 3's reflection work); `docs/PHASE-5.5-RECOVERY-GATE.md:232-235`.
- **Release impact:** None (read). No gate is named for this entry in any document.

The INC-001 recovery prompt's §5.1 groups its audit coverage under the Correction Pack's numbering, offsetting the residual and reflection topics by one phase against the Bible. The RFC records that this is the same root cause as `PHASE4_LABEL_DRIFT` — the Correction Pack's §9 calls the residual phase "Phase 4" (`docs/RFC/RFC-0001.md:150-151`) — and that every listed topic was audited with the matrix keyed to the Bible. What remains open is the prompt's text, not the audit. What would settle it: an owner decision to correct the prompt's §5.1 headings, or a statement that the prompt is frozen history and the drift stands permanently recorded.

### `RFC MISMATCH: ADR_NUMBER_COLLISION`

- **Status:** RESOLVED
- **Owner:** engineering
- **Decision:** Existing ADR history was preserved and Phase 3.5 uses `ADR-0008` through `ADR-0010`.
- **Evidence:** `docs/RFC/RFC-0001.md:159-160`; `docs/断点记录.md:679` (BP-032, which is the breakpoint-side source of this label); `docs/ADR/` carries `ADR-0008-phase35-writer-identity-acl.md`, `ADR-0009-phase35-expectation-verification-semantics.md`, `ADR-0010-phase35-local-runtime-backup-privacy.md`.
- **Release impact:** None.

The RFC entry carries only the resolution, not the conflict detail; the detail is in BP-032 (`docs/断点记录.md:673-679`), which records that Phase 3.5 used `ADR-0008`–`ADR-0010` because `ADR-0004`–`0006` were taken.

### `RFC MISMATCH: SQLITE_BACKUP_API_VERSION`

- **Status:** ACCEPTED-DEVIATION
- **Owner:** engineering
- **Decision:** The pinned Node `22.13.0` baseline uses `VACUUM INTO`; the later `DatabaseSync.backup()` convenience API is not used to justify a runtime upgrade.
- **Evidence:** `docs/RFC/RFC-0001.md:161-165`; `docs/PHASE-5-GATE.md:319-321` ("`VACUUM INTO` remains the pinned backup path for that baseline"); the deviation is registered from the breakpoint side at `docs/断点记录.md:679`.
- **Release impact:** None.

The RFC adds the fact that `node:sqlite` remains experimental in the pinned release even though the flag is no longer required (`docs/RFC/RFC-0001.md:163-165`). The deviation is deliberately kept: it is a runtime-baseline position, and the RFC states the upgrade is not justified by the API.

### `RFC MISMATCH: PHASE4_LABEL_DRIFT`

- **Status:** RESOLVED
- **Owner:** engineering
- **Decision:** A Correction Pack label says "Residual Engine" while the Bible and this document's delivery table define Phase 4 as EPIC-007 Reusable Assets; the Bible controls the implementation.
- **Evidence:** `docs/RFC/RFC-0001.md:166-168`; `docs/PHASE-3.5-GATE.md:30`; `docs/PHASE-4-GATE.md:24`; `docs/ADR/ADR-0011-phase4-reusable-assets.md:18`.
- **Release impact:** None.

The RFC records in the Phase 6 delivery-order entry that this ordering question "has a history" (`docs/RFC/RFC-0001.md:334-336`). The rule is stated once and applied: where the Correction Pack's label and the Bible disagree, the Bible names the phase.

### `RFC MISMATCH: ASSET_RESTORE_PERMISSION_SCOPE`

- **Status:** RESOLVED
- **Owner:** engineering
- **Decision:** Restore was given a dedicated `asset.restore` scope with regression coverage instead of being silently mapped to `asset.propose`.
- **Evidence:** `docs/RFC/RFC-0001.md:169-171`; `schemas/writer-context.v1.schema.json:39` carries `asset.restore`; `docs/断点记录.md:785-799` (BP-038 §纠偏 item 1 and the 86/86 result).
- **Release impact:** None.

BP-038 records the shape of the fix: the ACL contract had gained `asset.restore` before the WriterContext JSON schema did, and the schema-parity gate failed until both agreed. The fix moved the code and the schema together rather than relaxing the gate.

### `RFC MISMATCH: LEGACY_INPUT_NOT_IN_REPOSITORY`

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** The owner authorised a read-only public fetch of the first-generation source; the field map was derived from it and the repository fixture is synthetic, with the owner's runtime data staying outside the repository.
- **Evidence:** `docs/RFC/RFC-0001.md:172-177`; `docs/PHASE-5-GATE.md:272-275`; `docs/migration/LEGACY-FIELD-MAP.md` exists and is the map the RFC names at `docs/RFC/RFC-0001.md:98-100`.
- **Release impact:** None.

The Bible named `codex-habit main@c3be4af` as the migration input and neither the source nor the data was in the repository. The breakpoints that produced this entry are BP-043 (`docs/断点记录.md:869-929`), which also records that the first generation's own readers cannot match its CRLF frontmatter anchors.

### `RFC MISMATCH: LEGACY_ANOMALY_CLASSES_EXTENDED`

- **Status:** ACCEPTED-DEVIATION
- **Owner:** author
- **Decision:** The Bible's fifth, unnamed condition is named `cartesian_relation`, and four further conditions the table cannot express (`parse_error`, `encoding_marker`, `unmapped_path`, `privacy_sensitive`) are implemented as distinct classes rather than folded into an existing one.
- **Evidence:** `docs/RFC/RFC-0001.md:178-186`; `docs/PHASE-5-GATE.md:276-280`; `docs/ADR/ADR-0012-phase5-legacy-migration.md`; `docs/RFC/RFC-0001.md:100-107` for the reason the folding was refused.
- **Release impact:** None.

The RFC's stated reason is that folding any of them into an existing class "would have reported a parse failure as 'possibly overwritten' — a claim about history the evidence does not support" (`docs/RFC/RFC-0001.md:105-107`). The deviation is deliberate and stays.

### `OPEN GAP: CONFIGURATION_SURFACE`

- **Status:** NEEDS-EVIDENCE
- **Owner:** author
- **Decision:** Not decided. One of the four knobs is delivered; the other three remain package defaults, with the reason recorded and no owner ruling (`docs/RFC/RFC-0001.md:192-193`).
- **Evidence:** `docs/RFC/RFC-0001.md:187-193`; `schemas/praxis-config.v1.schema.json:42-45` carries only `minimumEvidence` and `minimumIndependentEpisodes`; `docs/PHASE-5-GATE.md:255-270` (the four-knob table and "Decision owner: the repository owner"); `docs/eval/CONCURRENCY-PLAN.md:234-242`; `docs/RFC/RFC-0001.md:22`.
- **Release impact:** Future Improvement. No gate is named; the gap map records the item as "config UX — **Requirement identified**" among the §14 items that are Release Engineering's work (`docs/release/PRE-RELEASE-GAP-MAP.md:112`, `:129-131`), which is a requirement rather than a blocker. The recorded cost is that C3 cannot run a threshold sweep: "C3 can run against the defaults; it cannot run a **threshold sweep**" (`docs/eval/CONCURRENCY-PLAN.md:240`).

**Carried forward from `_INVENTORY-RAW.md` Part 2, verified here:** this label is spelled `OPEN GAP:`, not `RFC MISMATCH:`, while sitting in the same registry (`docs/RFC/RFC-0001.md:187`). That is inconsistent with invariant 10, which requires structural mismatches to be reported as `RFC MISMATCH` and never silently compensated (`docs/RFC/RFC-0001.md:22`). The line count is confirmed: 23 labels spelled `RFC MISMATCH:` plus this one.

The RFC's reason for not threading the three knobs is that doing so "would change the verified Phase 3 and Phase 4 constructor boundaries" (`docs/PHASE-5-GATE.md:268-270`). What would settle the status: an owner decision to thread them and accept that change, or to declare them permanently package defaults; separately, whether the label is re-spelled to match invariant 10.

---

## Registrations of 2026-09-16 (`### Phase 5 departures registered on 2026-09-16`, RFC-0001.md:195-255)

### `RFC MISMATCH: LEGACY_PATTERN_TO_CANDIDATE_ASSET`

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** Option B: the importer keeps no `asset.*` scope, and a pattern reaches candidate-asset status only through an explicit human-run step.
- **Evidence:** `docs/断点记录.md:1212` ("作者已冻结为 Option B") and `:1214-1221` (the three commands and the provenance rule); the command exists in `apps/cli/src/args.ts:109` (`"legacy convert": ["asset-id", "reason", "at"]`) and `apps/cli/src/index.ts:1643`.
- **Release impact:** None.

**Carried forward from `_INVENTORY-RAW.md` Part 2, verified here:** `docs/RFC/RFC-0001.md:210-216` still presents the choice as open — "(A) keep the confinement and register this mismatch … (B) add an explicit post-import step that a human runs to propose a candidate asset from a named imported pattern. Decision owner: the repository owner." BP-051 records the author's freeze as Option B and the implementation of `praxis legacy convert`, which is exactly option B's post-import step. The RFC entry was not updated; the file's modification time (`2026-09-17 21:00`) is later than BP-051's date, so this is a document that was not amended rather than a decision that postdates it. `RFC-0001.md:469-471` states the general policy behind leaving entries unamended — "a mismatch whose text is amended to agree with the outcome stops being a record of what was found" — but that policy is applied there to the three 6V-PREP entries, which do carry separate decision blocks; this entry carries none. A reader of `RFC-0001.md` alone cannot learn that the decision was taken.

### `RFC MISMATCH: GOLDEN_FIXTURE_01_ABSENT`

- **Status:** BLOCKING
- **Owner:** author
- **Decision:** The fixture is requested from the owner rather than fabricated, and it blocks Alpha exit criterion 11.
- **Evidence:** `docs/RFC/RFC-0001.md:217-226`; `docs/PHASE-6-FINAL-GATE.md:110-118` and `:129` ("blocked on author material that may never arrive"); `docs/PHASE-6-GATE.md:87`; `fixtures/` contains only `legacy/` and `phase35/`, no Golden Fixture 01.
- **Release impact:** Blocks Alpha (`docs/RFC/RFC-0001.md:224-225`; `docs/PHASE-6-GATE.md:87`; `docs/PHASE-5.5-RECOVERY-GATE.md:216-217`).

Bible §14 specifies a sanitised minimal event set for the 《红色源代码：洪湖篇》 Production Card collaboration chain with at least one counterexample, and the Bible's own instruction for missing material is 「素材不足 → 请求补素材」 (`docs/RFC/RFC-0001.md:222`). Two artefacts are outstanding: `MR-01` and `MR-02` (`docs/PHASE-6-FINAL-GATE.md:113-115`). This is the only row in the registry that is BLOCKING. Two documents put the same fixture at two gates and both are right: the RFC and the Phase 6 gate make it an Alpha-exit blocker (`docs/RFC/RFC-0001.md:224-225`; `docs/PHASE-6-GATE.md:87`), and `docs/release/PRE-RELEASE-GAP-MAP.md:45` lists "Golden Fixture 01 — `WAITING_FOR_AUTHOR_SOURCE`" under `Blocks Phase 6 Final`. The `Blocks Alpha` value here follows the RFC's own sentence; a reader who needs the union should take both rows.

### `RFC MISMATCH: DOCTOR_COVERAGE_VS_13_1`

- **Status:** DEFERRED
- **Owner:** author
- **Decision:** The missing checks are registered rather than claimed; the owner decided not to close them in the limited INC-001 repair, so Phase 5 remains `PARTIAL` on issue 081.
- **Evidence:** `docs/RFC/RFC-0001.md:227-239`; `docs/PHASE-5.5-RECOVERY-GATE.md:288-295` ("The owner has decided **not** to close this in the limited repair"); `docs/PHASE-6-GATE.md:85` ("declined for the limited repair"); the current check list is `packages/runtime/src/index.ts:3618-3752`.
- **Release impact:** Blocks Pre-Release Compatibility Audit (read). The undelivered items are the compatibility ones — migration version _compatibility_, event-schema/`content_hash` sampling, `PRAGMA integrity_check` on the main path (`docs/RFC/RFC-0001.md:231-235`) — and no other gate is named for the entry (`docs/PHASE-6-GATE.md:80-81`: none of the carried-forward items blocks Phase 6B).

The RFC also records that the gate's issue-081 row claimed `PASS` for a coverage its own text did not demonstrate and cited a "doctor check list below" the document does not contain (`docs/RFC/RFC-0001.md:235-238`); both were corrected in `docs/PHASE-5-GATE.md`. Checked against the tree on 2026-09-18: `packages/runtime/src/index.ts:3618-3700` registers `writer-lock`, `sqlite-wal`, `writer-provenance`, `wal-checkpoint`, `orphan-verification`, `purge-state`, `managed-backup-integrity` and `asset-provenance`; `:3701-3736` adds one check per expected projection; `:3737-3746` adds `legacy-import-integrity`. There is no `integrity_check` on the main path, no schema or `content_hash` sampling, and no stale-snapshot or orphan-`projection_data` check, so the entry's list still describes the tree.

### `RFC MISMATCH: CLI_SURFACE_GAPS_VS_13`

- **Status:** NEEDS-EVIDENCE
- **Owner:** author
- **Decision:** Not decided, and the entry's text no longer describes the implementation: two of the three gaps it names are closed in the tree, and the third is not.
- **Evidence:** `docs/RFC/RFC-0001.md:240-246`; `apps/cli/src/args.ts:58` (`rebuild: ["projection"]`) and `apps/cli/src/index.ts:549-558`, `:1633` (`praxis rebuild [--projection <name>] | praxis projection rebuild [--projection <name>]`); `apps/cli/src/args.ts:104` (`legacy import` accepts `report`) and `apps/cli/src/index.ts:944-963`, `:1127-1129`, `:1639-1640` (`writeLegacyReport`, `--report <path>`); `apps/cli/src/args.ts:110-117` (`privacy purge` flags: `session`, `dry-run`, `confirm`, `plan-hash`, `preserve-managed-backups`, `finalize-pending`, no positional scope).
- **Release impact:** Future Improvement (read). No gate is named; the residual divergence is the `purge` argument shape.

The RFC entry says the implementation "accepts no `--projection` on `rebuild` (there is no way to rebuild a single projection)", "takes `purge --session <id>` rather than a positional scope", and "writes the migration report to stdout and the run tables rather than to a report path". The first and third are no longer true at this tree; the second is. `docs/断点记录.md:1202` (BP-051) records the rebuild routing fix and its test coverage. What would settle the status: an amended entry stating what actually remains, plus an owner decision on whether taking a session id instead of Bible §13's positional `<scope>` is an accepted deviation.

### `RFC MISMATCH: TEST_LAYER_STRUCTURE`

- **Status:** RESOLVED
- **Owner:** engineering
- **Decision:** Both missing layers now exist and are collected by `pnpm verify`.
- **Evidence:** `docs/RFC/RFC-0001.md:253-255` ("**Partially resolved on 2026-09-16:** both layers now exist and are collected by `pnpm verify` (steps 7 and 8)"); `tests/replay/` and `tests/regression/` exist; `package.json:39-40` defines `test:replay` and `test:regression`; `package.json:45` puts both in `verify:chain`; `scripts/gate.mjs:75-76` carries them as stages; `docs/PHASE-6-GATE.md:64-67` reports `unit 58 / integration 128 / replay 15 / regression 7`.
- **Release impact:** None.

The original mismatch was that `tests/replay/` and `tests/regression/` "do not exist and never have" (`docs/RFC/RFC-0001.md:249-250`). They exist, are populated, and are gate stages. The RFC keeps the historical statement deliberately, "because it records what was true when the mismatch was raised".

---

## Registrations of the P6-R0 audit and the P5-OPEN repair (`RFC-0001.md:257-320`)

### `RFC MISMATCH: GOLDEN_FIXTURE_01_PHASE6_START`

- **Status:** RESOLVED
- **Owner:** engineering
- **Decision:** The fixture does not block Phase 6 start; Bible §18 criterion 11 makes it an Alpha-exit blocker, and the gate documents were corrected to say so.
- **Evidence:** `docs/RFC/RFC-0001.md:264-274`; `docs/PHASE-5.5-RECOVERY-GATE.md:219-226` ("**Corrected 2026-09-16.**") and `:304-306`; `docs/PHASE-6-GATE.md:87`; `docs/断点记录.md:1272-1278` (BP-054).
- **Release impact:** None. The classification itself gates nothing, and the fixture's blocking is reported once, under `GOLDEN_FIXTURE_01_ABSENT`, whose text states the gate (`docs/RFC/RFC-0001.md:224`).

The correction moved the requirement off Phase 6 and did not touch the requirement: it is still `WAITING_FOR_AUTHOR_SOURCE` and must not be synthesised (`docs/RFC/RFC-0001.md:271-273`).

### `RFC MISMATCH: EVENT_TAXONOMY_VS_5_4`

- **Status:** NEEDS-EVIDENCE
- **Owner:** author
- **Decision:** Not decided. The divergence is registered rather than carried as audit prose; renaming the events is a separate owner decision.
- **Evidence:** `docs/RFC/RFC-0001.md:275-288`; `docs/PHASE-5.5-RECOVERY-GATE.md:296-299` ("Registration is the Bible's required handling; renaming the events is a separate owner decision"); `docs/PHASE-6-GATE.md:86`.
- **Release impact:** Blocks Pre-Release Compatibility Audit (read). The emitted event-name set is an interchange surface, and `docs/RFC/RFC-0001.md:52` requires a schema-parity gate "before external producers are admitted"; no gate is named for this entry itself.

Checked against the tree on 2026-09-18: a search over `packages/`, `apps/`, `migrations/` and `schemas/` finds no occurrence of `expectation.resolved`, `reflection.accepted`, `reflection.rejected`, `asset.activated`, `asset.challenged`, `asset.disabled`, `asset.forked`, `privacy.tombstoned` or `privacy.purged` as event types. The nine `asset.forked` hits are the field name `asset.forkedFrom` (`packages/runtime/src/index.ts:1630-1632`, `packages/store/src/sqlite.ts:2630-2632`). The RFC's other half — that the implementation emits types the list does not name — is consistent with `RFC MISMATCH: AGENT_CURSOR_STORAGE_VS_APPENDIX_B`, which records `agent.cursor.updated` as the cursor carrier. What would settle the status: an owner decision accepting the structural representation as a deviation, or a rename plan.

### `RFC MISMATCH: DOCTOR_SCOPE_VS_081`

- **Status:** DEFERRED
- **Owner:** author
- **Decision:** `cursors` and `context` remain outside doctor's scope; the owner declined to close them in the limited repair and Phase 5 stays `PARTIAL` on issue 081.
- **Evidence:** `docs/RFC/RFC-0001.md:289-297`; `docs/PHASE-5.5-RECOVERY-GATE.md:288-295`; `docs/PHASE-6-GATE.md:85`; `docs/incidents/INC-001-bible-conformance-audit.md:199` (migration version ↔ app compatibility: `ABSENT`); `packages/runtime/src/index.ts:3618-3752` carries no cursor check and no context-exposure check.
- **Release impact:** Blocks Pre-Release Compatibility Audit (read). The unchecked conditions are cursor corruption and schema drift, which are compatibility checks; no other gate is named.

The RFC's two concrete examples are an agent cursor pointing at a non-existent seq, which is refused at projection rebuild but is not a doctor finding, and a `context.item.exposed` row with no matching plan, for which migration `0005` provides SQLite triggers rather than a doctor check (`docs/RFC/RFC-0001.md:291-294`). Neither is present in the check list read above.

### `RFC MISMATCH: AGENT_CURSOR_STORAGE_VS_APPENDIX_B`

- **Status:** ACCEPTED-DEVIATION
- **Owner:** engineering
- **Decision:** Cursors are stored as `agent.cursor.updated` events reduced into the `agents` projection rather than in an `agent_cursors` table, and no invariant is broken because Appendix B is labelled 建议 rather than frozen.
- **Evidence:** `docs/RFC/RFC-0001.md:298-306`; `packages/state/src/index.ts:79` (the `AgentCursor` interface) and `:434` (the `agent.cursor.updated` reducer); no `agent_cursors` table exists anywhere under `migrations/` or `packages/`.
- **Release impact:** None.

The RFC records that Appendix A's `AgentCursor` shape is matched exactly and that Bible §5.2's rule that 「所有 projection cursor、agent cursor、snapshot cursor 均使用 seq」 is satisfied, so the departure is one of storage representation rather than behaviour. It also records that the departure "was nevertheless undeclared" (`docs/RFC/RFC-0001.md:304-305`).

### `RFC MISMATCH: REPOSITORY_VISIBILITY_VS_FROZEN_DECISION`

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** The owner confirmed on 2026-09-17 that PUBLIC is an intentional choice — the project is open source as a pre-alpha / research preview from the Phase 5 baseline — and it does not return to private.
- **Evidence:** `docs/RFC/RFC-0001.md:307-320`; `docs/断点记录.md:1330` (「作者确认 PUBLIC 是有意选择」) and `:1324-1326` (the 未决 section it closes); `docs/PHASE-6B-GATE.md:239-252` (four repository controls enabled on 2026-09-17); `docs/断点记录.md:1351` (the redaction cannot reach the paths inside the blobs introduced by `e7f42bf`, `ca42c1f`, `ded9ec6`, and rewriting history was not authorised).
- **Release impact:** None.

Two things the RFC entry does not carry. First, the ruling is in `docs/断点记录.md:1328-1330`; `RFC-0001.md:318-320` still says "No action was taken … Decision owner: the repository owner", so a reader of the RFC alone cannot learn that the owner decided. Second, the recovery commits were local when the entry was written and were pushed on 2026-09-17 (`docs/断点记录.md:1553`), which makes the ruling load-bearing for what is public, not only for what was already public. `docs/SOURCE-MANIFEST.md` carries a documented redaction (`docs/断点记录.md:1348-1350`) and the historical blobs were left alone.

---

## Registrations of 2026-09-17

### `RFC MISMATCH: PHASE6_DELIVERY_ORDER` (owner-frozen deviation, RFC-0001.md:322-351)

- **Status:** ACCEPTED-DEVIATION
- **Owner:** author
- **Decision:** Phase 6A is hardening and field validation of the already-implemented EPIC-007 surface with no new capability, and Phase 6B is the Bible's EPIC-010.
- **Evidence:** `docs/RFC/RFC-0001.md:327-351`; `docs/断点记录.md:1353-1383` (BP-057); `docs/PHASE-6-GATE.md:25-29`; `docs/PHASE-6B-GATE.md:17-19`.
- **Release impact:** None.

The entry is registered rather than executed silently, which is the whole of its requirement: "building on an unregistered deviation is the failure INC-001 exists to correct" (`docs/RFC/RFC-0001.md:322-325`). The charter that bounds Phase 6A is listed in the entry (`docs/RFC/RFC-0001.md:344-350`) and repeated in `docs/PHASE-6-GATE.md:11-30`, together with the statement that Alpha release remains `NO-GO`.

### `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` (RFC-0001.md:353-373)

- **Status:** ACCEPTED-DEVIATION
- **Owner:** author
- **Decision:** The adapter ports take a second `AdapterExecutionContext` argument — a change to a frozen port, registered rather than absorbed.
- **Evidence:** `docs/RFC/RFC-0001.md:355-373`; `docs/ADR/ADR-0014-phase6b-adapter-boundary.md:3` ("**Status:** Accepted for Phase 6B"), `:35-49` ("This is a **change to a frozen port**, registered as `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` rather than absorbed"); `packages/adapters/src/dummy.ts:133`, `:156`, `:201`, `:306`.
- **Release impact:** Blocks Release Engineering. `docs/release/PRE-RELEASE-GAP-MAP.md:116` names this label as the blocker for the "stable extension ABI" item — "the adapter boundary is `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2`; it is not frozen" — and `:129-131` places the §14 items among Release Engineering's work.

The RFC entry presents options (A) and (B), recommends A with the same argument the ADR gives, and records no owner pick: "Decision owner: the repository owner" (`docs/RFC/RFC-0001.md:373`). The ADR records the extended signature as a decision under `## Decisions` and the code implements it. The RFC entry was not updated, so the choice reads as pending in the registry while it is settled in `ADR-0014`; this is the second place where an RFC entry and a decision document disagree about what is settled (the first is `LEGACY_PATTERN_TO_CANDIDATE_ASSET`). The deviation being accepted and the boundary being unfrozen are not in tension: `ADR-0014` settles what the port takes today, and the gap map records that a third party cannot yet write against it as a stable contract.

### `RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING` (RFC-0001.md:375-384)

- **Status:** DEFERRED
- **Owner:** author
- **Decision:** The comparison is recorded rather than met; it closes when a real provider adapter is authorised and the same core fixture is run across both subjects.
- **Evidence:** `docs/RFC/RFC-0001.md:375-384`; `docs/RFC/RFC-0001.md:515` ("stays **open** until a `6V-2X` run exists"); `docs/PHASE-6B-GATE.md:236` and `:294` ("Issue 095 scaffold portability PENDING — needs a real provider adapter"); `docs/eval/CONCURRENCY-PLAN.md:166-177` (subject A exists, subject B is "Blocked on `MR-07`").
- **Release impact:** Blocks Phase 6 Final. `6V-2X` is one of the Phase 6 gates and is `NOT RUN` (`docs/PHASE-6-FINAL-GATE.md:25`), and the same document states that this is the experiment which would close the entry (`docs/PHASE-6-FINAL-GATE.md:99-108`).

The RFC gives the reason the test cannot be written: "the test cannot be written against a subject that does not exist, and inventing a 'provider adapter' that is another dummy would test nothing while reading as evidence" (`docs/RFC/RFC-0001.md:380-382`). `docs/PHASE-6B-GATE.md:49-54` records that no provider adapter was written and why.

### `RFC MISMATCH: GOLDEN_FIXTURE_01_UNPLACED_IN_6V_ORDER` (RFC-0001.md:386-412)

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** Option A: the fixture is placed after `6V-2X` as the Phase 6 final behavioural gate, and the 6V-PREP brief's §26 is read as a refinement of the ladder rather than as superseding it.
- **Evidence:** `docs/RFC/RFC-0001.md:392-412`; `docs/RFC/RFC-0001.md:473-483` ("**RESOLVED, option A.**"); `docs/eval/PHASE-6V-PLAN.md:400` (§6, "The unplaced rung — Golden Fixture 01").
- **Release impact:** Blocks Phase 6 Final. The decision states that the fixture does **not** block `6V-0`, `6V-1` or `6V-2` but "**does** block final Phase 6 PASS" (`docs/RFC/RFC-0001.md:474-476`), and that a missing source leaves the rung `WAITING_FOR_AUTHOR_SOURCE` with the final gate reporting `BLOCKED — GF01 SOURCE REQUIRED` (`docs/RFC/RFC-0001.md:479-483`). This is the same fixture as `GOLDEN_FIXTURE_01_ABSENT`, gating a different gate; each is reported once.

The two ladders are otherwise compatible — 6V-1 refines L1, 6V-2 refines L2, 6V-3 is L3, 6V-4 is L4 — and the RFC records why taking the brief's §26 literally would drop the fixture or place it where the instrumentation is unproven (`docs/RFC/RFC-0001.md:399-405`).

### `RFC MISMATCH: FIELD_CONTEXT_SOCIAL_PLURALITY` (RFC-0001.md:414-433)

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** Social plurality stays evaluation-derived metadata for the whole of Phase 6; the runtime `FieldContext` contract is not modified, and it becomes a declared field only if Phase 6 evidence shows a core semantic requirement.
- **Evidence:** `docs/RFC/RFC-0001.md:414-433`; `docs/RFC/RFC-0001.md:485-493` ("**RESOLVED, remains derived.**"); `schemas/eval/run-manifest.v1.schema.json:87` (the field context description: "the runtime's own five axes plus the derived plurality count") and `:107-108` ("DERIVED, not declared: computed from `actors.length` so that it cannot contradict the actor list … Bands: single-actor = 1, few = 2-4, many = 5+").
- **Release impact:** Future Improvement, following `docs/release/PRE-RELEASE-GAP-MAP.md:95`, which lists "`socialPlurality` is derived in the harness and absent from the runtime's `FieldContext`" in that category with this label as its source. The decision settles the runtime contract; it does not close the harness/runtime difference, and the gap map carries it forward.

The plan claimed a scenario is described by 「the same six dimensions the runtime already models in `FieldContext`」; Bible §8.1's contract has five axes, an actor list and a rule list, and social plurality is neither a field nor derived by the runtime (`docs/RFC/RFC-0001.md:415-420`). The RFC records that no invariant is broken because plurality is inferable from `actors.length`, and that the inaccuracy was in the plan's claim about what the contract carries. `docs/engineering/ARCHITECTURE-SELF-REVIEW.md:243` reaches the same description of where the field lives.

### `RFC MISMATCH: SCAFFOLD_PORTABILITY_METHOD_BROADENED` (RFC-0001.md:435-459)

- **Status:** RESOLVED
- **Owner:** author
- **Decision:** Option A: the Bible's issue-095 condition and the brief's stronger condition are named separately — engineering portability is the gate, behavioural portability is a metric — so neither can stand in for the other in a report.
- **Evidence:** `docs/RFC/RFC-0001.md:435-459`; `docs/RFC/RFC-0001.md:495-516`; `docs/eval/CONCURRENCY-PLAN.md:144-164` (the two named claims) and `:128-142` (the comparison set).
- **Release impact:** None.

The division is explicit about what does not follow: a `6V-2X` run that satisfies the stronger test does not close the `PENDING` entry, and a run that fails it may still close it (`docs/RFC/RFC-0001.md:506-508`, `docs/eval/CONCURRENCY-PLAN.md:156-160`). Under that division the hard equality requirement is the event-type set, the projection versions and the payload shapes, "a difference there is a contract violation rather than a finding" (`docs/RFC/RFC-0001.md:510-514`).

---

## Cross-checks the brief asked for

Nine areas were named. Each is mapped to the labels that cover it, and where an area has no registered mismatch, the absence is stated.

### Historical label drift

Two labels: `PHASE4_LABEL_DRIFT` (`docs/RFC/RFC-0001.md:166-168`, RESOLVED) and `PHASE_LABEL_DRIFT_IN_RECOVERY_PROMPT` (`:144-155`, NEEDS-EVIDENCE). Both name the same root cause — the Correction Pack's §9 calls the residual phase "Phase 4" (`:150-151`) — and both are document-level: neither concerns the runtime. The Phase 6 delivery-order entry records that this numbering question "has a history" (`:334-336`).

No other label drift is registered. `ADR_NUMBER_COLLISION` (`:159-160`) is repository-ADR numbering, not phase labelling, and `PHASE6_DELIVERY_ORDER` (`:327-351`) is a delivery-order deviation with no labelling component.

### Adapter deviations

Three labels: `ADAPTER_EXECUTION_CONTEXT_VS_10_2` (`:355-373`, ACCEPTED-DEVIATION), `SCAFFOLD_PORTABILITY_PENDING` (`:375-384`, DEFERRED), `SCAFFOLD_PORTABILITY_METHOD_BROADENED` (`:435-459`, RESOLVED).

Absence worth naming: `docs/PHASE-6B-GATE.md:226-237` lists six remaining gaps from the Phase 6B boundary, and none of them is an `RFC MISMATCH` label. Three would read as mismatch-shaped — no runtime integration (`:232`), no independent adopter for the conformance suite (`:234`), and `adapterExecutionContextSchema` cannot be a wire schema because it carries an `AbortSignal` (`:235`). They are recorded as gate gaps only. The registry is not the only place departures live.

One outward consequence, recorded elsewhere: `docs/release/PRE-RELEASE-GAP-MAP.md:116` names `ADAPTER_EXECUTION_CONTEXT_VS_10_2` as the blocker for a stable extension ABI, "it is not frozen". An accepted internal deviation and an un-frozen external contract are the same fact read from two sides.

### Doctor gaps

Two labels, both DEFERRED, both declined for the limited repair: `DOCTOR_COVERAGE_VS_13_1` (`:227-239`) and `DOCTOR_SCOPE_VS_081` (`:289-297`). Both are read here against `packages/runtime/src/index.ts:3618-3752`, whose check list contains eight named checks, one check per expected projection, and the legacy-import check, and no `integrity_check` on the main path, no schema or `content_hash` sampling, and no agent-cursor or context-exposure check. One further item from the same gate list is not a label: "the `config` check still cannot fail" (`docs/PHASE-5.5-RECOVERY-GATE.md:292`), which the CLI bears out — `apps/cli/src/index.ts:347-359` builds the check with `status: "pass" as const`.

### Portability

The registry uses the word twice with different meanings. Runtime-baseline portability: `SQLITE_BACKUP_API_VERSION` (`:161-165`, ACCEPTED-DEVIATION). Scaffold portability: `SCAFFOLD_PORTABILITY_PENDING` (`:375-384`) and `SCAFFOLD_PORTABILITY_METHOD_BROADENED` (`:435-459`).

Absence worth naming: the pinned-runtime portability problem — Node `22.13.0` on both platforms — has no `RFC MISMATCH` label. It is carried as breakpoints `BP-010`, `BP-016`, `BP-024` (`docs/断点记录.md:222`, `:343`, `:512`), closed as a gate at `BP-041` (`:832`), and re-opened as an evidence-scope question by `BP-062` (`:1545`); the current state is `docs/PHASE-6-FINAL-GATE.md:20-21` and `:57-60`. The platform-portability defects found when CI first ran are breakpoints too — `BP-061` (POSIX path rule), `BP-062` (single-platform evidence), `BP-063` (stream order on the pinned runtime) at `docs/断点记录.md:1502`, `:1545`, `:1580` — not mismatches. The registry and the breakpoint record are two different instruments, and portability lives mostly in the second.

Cross-read against the release phase's own inventory of the same area (`docs/release/PRE-RELEASE-GAP-MAP.md:48-56`): its `Blocks Pre-Release Compatibility Audit` rows are macOS/arm64 coverage, pinned-runtime coverage, the supported-provider matrix, shell sensitivity and network-environment behaviour. The provider-neutrality row cites "the `RFC MISMATCH` set" as its source without naming a label (`:54`); the scaffold-portability pair and the pinned-runtime row are not named there at all. The two instruments are not aligned item by item, and this document did not attempt to align them.

### Golden Fixture

Three labels, one fixture: `GOLDEN_FIXTURE_01_ABSENT` (`:217-226`), `GOLDEN_FIXTURE_01_PHASE6_START` (`:264-274`), `GOLDEN_FIXTURE_01_UNPLACED_IN_6V_ORDER` (`:392-412`). Two of the three are about which gate the fixture blocks, and both of those are settled; one is about the fixture itself and is open. No fourth label is registered: the material requests (`MR-01`, `MR-02`) are not spelled as mismatches — they live in `docs/eval/MATERIAL-REQUEST.md` and are summarised at `docs/PHASE-6-FINAL-GATE.md:110-118`. One classification difference, not a conflict: `docs/release/PRE-RELEASE-GAP-MAP.md:45` lists the fixture under `Blocks Phase 6 Final` while the RFC places it at Alpha exit criterion 11; both are cited in the `GOLDEN_FIXTURE_01_ABSENT` entry above.

### FieldContext differences

One label: `FIELD_CONTEXT_SOCIAL_PLURALITY` (`:414-433`, RESOLVED). The RFC states exactly one difference — the plan's claim of six dimensions against the contract's five axes plus an actor list and a rule list (`:415-420`) — and describes no other. Read against `schemas/eval/run-manifest.v1.schema.json:87-108`, the discrepancy is handled where the RFC says: the manifest carries the field, marks it DERIVED, and maps it to bands.

### Scaffold portability

The same two labels as §Portability, and the RFC's clearest case of a division made deliberately: the weaker condition (issue 095) is the gate, the stronger condition (the brief's §17) is the experiment, and the two are named so that neither can be reported in the other's place (`docs/RFC/RFC-0001.md:444-459`, `:495-516`). Note the asymmetry the division creates: satisfying the stronger test does not close the `PENDING` entry (`:506-508`).

### Evaluation-derived fields

One registered field, `field.socialPlurality`, and it is the only field the RFC marks DERIVED (`schemas/eval/run-manifest.v1.schema.json:107-108`; `docs/RFC/RFC-0001.md:485-493`).

Absence worth naming: the evaluation harness itself was not registered as a mismatch. `docs/PHASE-6-FINAL-GATE.md:82-86` records that metric definitions "have no implementation", there is no scenario registry, and run manifests are hand-written in one validation file; that is a missing subsystem, and the boundary it needed was decided the following day in `docs/ADR/ADR-0015-evaluation-harness-boundary.md` (status "Accepted for Phase 6V", dated 2026-09-18) rather than registered as an `RFC MISMATCH`. The registry therefore contains the harness's _derived-field_ consequence and not the harness's absence. The release phase's inventory records the same subsystem from its own side as "reproducible evaluation package | **Partial**" (`docs/release/PRE-RELEASE-GAP-MAP.md:152`), so the absence is tracked — just not as a mismatch.

### Configuration surface

One label: `OPEN GAP: CONFIGURATION_SURFACE` (`:187-193`) — and it is the only label in the registry not spelled `RFC MISMATCH:`, against invariant 10 (`:22`). The delivered knob is the promotion threshold (`schemas/praxis-config.v1.schema.json:42-45`); the three undelivered ones are context-ranking weights, reflection budgets and timing-residual thresholds (`docs/RFC/RFC-0001.md:190-192`); the reason they were not threaded is the constructor-boundary cost (`docs/PHASE-5-GATE.md:268-270`); the recorded consequence is C3's inability to sweep thresholds (`docs/eval/CONCURRENCY-PLAN.md:234-242`). The release phase's own inventory reaches the same item from the other side and reaches the same conclusion — "config UX | **Requirement identified**" among the §14 items, explicitly noting that it is "registered in `RFC-0001` but not under the `RFC MISMATCH:` spelling" (`docs/release/PRE-RELEASE-GAP-MAP.md:112`). The spelling is not a typo: it is carried as a gap rather than as a mismatch, and two documents now record that difference independently.

### Registry-adjacent open items that are not mismatches

Not one of the nine areas, but the same gap in the record. `docs/RFC/RFC-0001.md:120-130` carries three Phase 5 escalations: `BP-047` (fixed with a regression test), `BP-048` (avoided, corrections in `ADR-0012` §5.1) and `BP-049`, which the RFC itself marks "Open: changing it changes what `pnpm verify` is." `BP-049` is the only open item in `RFC-0001.md` that is not in the mismatch registry and not spelled as one; it is also the only item in the file that is a build-and-packaging concern, which is the one shape the registry does not contain at all. It is not lost: `docs/release/PRE-RELEASE-GAP-MAP.md:62` carries it as the first `Blocks Release Engineering` finding, in the same status (`未修复，待决策`), alongside the dependency advisories (`:64`) and the absent packaging surface (`:65`). Where the registry has no Release-Engineering shape, the release gap map does.

---

## Mismatches whose status the documents do not settle

Four rows are NEEDS-EVIDENCE. What would settle each:

1. **`PHASE_LABEL_DRIFT_IN_RECOVERY_PROMPT`** (`docs/RFC/RFC-0001.md:144-155`). The handling is recorded and the prompt's own text is not. Evidence that would settle it: a one-line owner decision either amending the recovery prompt's §5.1 headings, or declaring the prompt frozen history so the drift is permanently recorded. Nothing in the tree can settle it.
2. **`OPEN GAP: CONFIGURATION_SURFACE`** (`:187-193`). Evidence that would settle it: an owner decision to thread the three knobs, accepting the change to the verified Phase 3 and Phase 4 constructor boundaries (`docs/PHASE-5-GATE.md:268-270`), or to declare them permanently package defaults. A secondary question is whether the label is re-spelled `RFC MISMATCH:`, since invariant 10 (`:22`) covers it and the registry does not.
3. **`CLI_SURFACE_GAPS_VS_13`** (`:240-246`). Two of the three gaps it names are closed in the tree (evidence above), so the entry no longer describes the implementation. Evidence that would settle it: an amended entry stating what remains — `privacy purge` taking `--session <id>` (`apps/cli/src/args.ts:110-117`) — plus an owner decision on whether that shape is an accepted deviation from Bible §13's positional `<scope>`.
4. **`EVENT_TAXONOMY_VS_5_4`** (`:275-288`). The divergence is confirmed in the tree; registration is stated to be the required handling and renaming a separate decision (`docs/PHASE-5.5-RECOVERY-GATE.md:296-299`). Evidence that would settle it: an owner decision accepting the structural representation as a deviation, or a rename plan.

Two more rows are settled in substance but disputed between documents, which is a different failure from an unclear status and is listed here so it is not read as either:

5. **`LEGACY_PATTERN_TO_CANDIDATE_ASSET`** (`:202-216`). The decision is recorded in `docs/断点记录.md:1212` and implemented (`apps/cli/src/args.ts:109`); the RFC still presents (A)/(B) as open and carries no decision block. What would settle the record: an added decision block in the RFC, in the style the 6V-PREP section already uses (`:461-471`), not an edit to the entry text.
6. **`REPOSITORY_VISIBILITY_VS_FROZEN_DECISION`** (`:307-320`). The owner's ruling is in `docs/断点记录.md:1330`; the RFC still says "No action was taken … Decision owner: the repository owner". Same remedy.

One row could have been filed as settled and is not: `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` (`:355-373`) is marked ACCEPTED-DEVIATION because `docs/ADR/ADR-0014-phase6b-adapter-boundary.md:35-49` records the change as an accepted decision and the code implements it — but the RFC records no pick between (A) and (B), so a reader of `RFC-0001.md` alone would read it as pending. The call is this document's, and it is stated so it can be disagreed with.

No row was moved to RESOLVED because another row made the table look better. `RFC MISMATCH: GOLDEN_FIXTURE_01_PHASE6_START` is RESOLVED while the fixture is BLOCKING because the classification is a separate question from the material, and the two are stated separately in the RFC itself (`:264-274` against `:217-226`).

---

## What this document did not do

- **It did not re-audit the runtime.** Six code checks were made, each cited: the CLI flag table and the rebuild/report/purge wiring (`apps/cli/src/args.ts`, `apps/cli/src/index.ts`), the doctor check list (`packages/runtime/src/index.ts:3618-3752`), the absence of nine event-type names, the absence of an `agent_cursors` table and the presence of the `agents`-projection reducer, the presence of the four test layers (`tests/`, `package.json`, `scripts/gate.mjs`), and the configuration schema's knobs (`schemas/praxis-config.v1.schema.json`). Every other statement about the implementation is the documents' statement, not a verified one.
- **It did not modify anything.** `docs/RFC/RFC-0001.md`, `docs/断点记录.md` and every other file are as they were; this is the only file written. No registry entry was amended, re-spelled or closed.
- **It ran no git command**, so no state was changed and no history was read from the repository.
- **It did not query GitHub, the CI service, or any artifact.** The visibility facts, the repository security-control state and the CI results are cited from `docs/断点记录.md:1304-1351`, `docs/PHASE-6B-GATE.md:239-272` and `docs/PHASE-6-FINAL-GATE.md:28-60` as written.
- **It did not run `pnpm verify` or any test.** The test counts quoted (`unit 58 / integration 128 / replay 15 / regression 7`) come from `docs/PHASE-6-GATE.md:64-67`, not from a run performed here.
- **It did not read the Bible, the Correction Pack, the INC-001 recovery prompt, or the owner's briefs.** Claims about what those documents say are taken from `RFC-0001.md` and the gate documents, which quote them.
- **It did not close the four NEEDS-EVIDENCE rows**, and it did not re-derive the status of any row the inventory marked `OPEN` beyond what the RFC and the tree support; where this document disagrees with `_INVENTORY-RAW.md`'s mechanical status, the disagreement is argued in the entry.
- **It did not define the release-impact vocabulary, and it did not invent one.** The categories are `docs/release/PRE-RELEASE-GAP-MAP.md:36-95`'s, used under the owner's Phase 6V brief §20, and that document's own classification of two of these labels was followed rather than re-derived (`:95` for `FIELD_CONTEXT_SOCIAL_PLURALITY`, `:116` for `ADAPTER_EXECUTION_CONTEXT_VS_10_2`). The remaining assignments are anchored in document statements cited per entry, or marked `(read)`. What this document did add: `Blocks Release Engineering` now has one registry row, and the reason the rest of that category is empty is that its items are breakpoints and gate gaps, not registry labels — `BP-049` (`docs/release/PRE-RELEASE-GAP-MAP.md:62`; `docs/RFC/RFC-0001.md:128-130`), the four dependabot advisories (`:64`; `docs/PHASE-6-FINAL-GATE.md:131`), and the absent packaging surface (`:65`).
- **It did not read the sibling documents in full.** `docs/release/PRE-RELEASE-GAP-MAP.md` was read completely, because it defines the release-impact categories. `docs/engineering/ARCHITECTURE-SELF-REVIEW.md`, `docs/engineering/FAILURE-FAMILIES.md` and `docs/eval/` were searched for these labels only; where a claim of theirs is cited here, the cited line was read. Those documents were being written while this one was, and no attempt was made to reconcile them beyond the labels they share.
- **It does not know whether the two ends of the registry will stay in step.** Six of the nine cross-checked areas are covered by labels and three by breakpoints, gate-gap tables or ADRs instead. Nothing in this document proposes changing that; it records where each item lives so the next reader does not have to look twice.
