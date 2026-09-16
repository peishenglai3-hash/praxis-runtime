# Phase 5.5 — INC-001 Recovery Gate

**Status:** `RECOVERY BASELINE READY`
**Full Alpha gate:** **not** ready — Golden Fixture 01 and the pinned-runtime CI
evidence are outstanding, and both are stated below rather than absorbed.
**Incident:** INC-001 — Partial-Bible Execution / Compound Specification Drift
**Audit:** [`incidents/INC-001-bible-conformance-audit.md`](./incidents/INC-001-bible-conformance-audit.md)
**Incident record:** [`incidents/INC-001-partial-bible-execution.md`](./incidents/INC-001-partial-bible-execution.md)
**Baseline audited:** `542481b` (tag `inc-001-baseline`)
**Branch:** `incident/inc-001-phase55-recovery`

Per the recovery prompt: `PHASE 6 = NO-GO`, `RELEASE = NO-GO`,
`PUBLIC RELEASE = NO-GO`, `ARCHITECTURE REDESIGN = NO-GO`. This gate does not
lift any of them.

---

## 1. Authoritative documents read

Read in full by the main execution agent, per RULE-01, before any code changed:

`Codex_Implementation_Bible_v1.0` (995 lines) · `Codex_Phase3.5_Correction_Pack_v1.0`
(537 lines) · `docs/PHASE-3.5-GATE.md` · `docs/断点记录.md` (BP-001…BP-050) ·
`README.md` · `docs/ADR/ADR-0001`…`ADR-0013` · `docs/RFC/RFC-0001.md` ·
`docs/PHASE-5-GATE.md` · `docs/SOURCE-MANIFEST.md` ·
`docs/migration/LEGACY-FIELD-MAP.md` · `docs/HANDOFF.md` · git history and reflog.

Sub-agents supplied mechanical inventories only (test, schema, migration, CLI,
event-type, doctor-check, verify-pipeline and CI counts). Every status and
severity in the audit is the main agent's judgement against the Bible text.

## 2. Phase status

| Phase | Bible scope         | Status    | Basis                                                                                                                                                                                                                                                                    |
| ----- | ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | EPIC-001            | `PASS`    | Reproducible workspace, strict TypeScript, boundaries with positive and negative fixtures, deterministic ports, ADR-0001–0004, CI on push and PR                                                                                                                         |
| 1     | EPIC-002            | `PASS`    | Event envelope with the Bible's structured source/evidence/links/provenance; single writer; seq cursor; 10k append; 4-process concurrency; crash recovery                                                                                                                |
| 2     | EPIC-003 + EPIC-004 | `PARTIAL` | Projection, snapshot, rebuild and context are implemented and tested; ranking weights match the Bible exactly (`0.35/0.25/0.15/0.15/0.10`). The agent-cursor shape deviates from Appendix B without a declaration, and the golden-replay layer was missing (now created) |
| 3     | EPIC-005 + EPIC-006 | `PARTIAL` | Three automatic residual families, `effect` fixed to `unknown`, budgets enforced, self-call guard present. The runaway **regression** required by issue 055 did not exist (now created)                                                                                  |
| 3.5   | Correction Pack     | `PARTIAL` | Gates A–D met within the declared local capability boundary. The ASYNC fixtures were not in the frozen replay layer (now there)                                                                                                                                          |
| 4     | EPIC-007            | `PASS`    | Asset lifecycle, CAS, provenance validation, promotion policy, human controls, doctor catalog-drift                                                                                                                                                                      |
| 5     | EPIC-008 + EPIC-009 | `PARTIAL` | Both epics delivered; issue 073 was not implemented (now is, per the frozen option B); issue 081's coverage was overstated (now corrected); 17 command paths had no executable coverage (now covered)                                                                    |

## 3. Mismatches

**CRITICAL: 0. No Bible invariant (INV-01…INV-10) is violated by this tree.**

### High — all resolved in this recovery

| #   | Finding                                                          | Resolution                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tests/replay/` absent (Bible §14, 026)                          | **Created.** `basic-ledger.fixture.json` + 6 tests: determinism, rebuild equivalence, snapshot recovery, cursor recovery, schema compatibility, hand-computed golden state                                                                |
| 2   | No runaway regression (Bible 055)                                | **Created.** Repeated no-evidence reflection stays `STOP`; budget exhaustion stops; a driven loop terminates within the budget                                                                                                            |
| 3   | ASYNC-01~04 not in the replay layer (Correction Pack §3.7)       | **Closed structurally** — `tests/replay/` now exists and the four ASYNC scenarios remain replayed in `tests/integration/phase35-expectation.test.ts`. Their stream construction is inline rather than a recorded fixture; see "Remaining" |
| 4   | 「旧 patterns → candidate asset」 unimplemented (Bible §12, 073) | **Implemented** per the frozen option B: `legacy patterns \| pattern \| convert`, running under `asset.propose`, carrying the pattern's `inferred` provenance forward, producing a `candidate` — never `active`                           |
| 5   | Doctor covered ~⅓ of §13.1 (§13.1, 081)                          | **Partly closed.** `rebuild --projection` exists; the missing checks are enumerated below as outstanding rather than claimed                                                                                                              |
| 6   | 082–086 marked `PASS` with no executable coverage                | **Closed.** `tests/integration/phase55-operator-surface.test.ts` (29 tests) covers every P0 path                                                                                                                                          |

### Medium — recorded, not silently absorbed

Bible 010 envelope schema is in no parity script · 022 agent-cursor deviation
undeclared and no `AgentCursor` contract type · 082 the `rebuild --projection`
gap (now implemented; the row is corrected) · 083/084 CLI coverage (now closed) ·
§13.2 three remaining configuration knobs · §9.2's `config` check emits a
hardcoded `"pass"` · §9.4 two invented event types · §9.5 fourteen §5.4 event
names differ from the Bible's literals.

### Low

`busy_timeout` asserted by no doctor check · §5.3 has no payload-size ceiling ·
074 archive is mandatory though the Bible says optional · 075 no candidate
counts · §16 branch/commit conventions · §17's `RFC MISMATCH` template unused.

## 4. P0 operator surface

INC-001 §7.1's list, with the coverage that now exists. Every entry asserts exit
code, success, refusal where one exists, and state-change or no-state-change
semantics — not merely that the command exists.

| Command                                                                | Covered by                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `state show`                                                           | `phase55-operator-surface.test.ts` — all projections, `--projection` narrowing, unknown name refused           |
| `rebuild`, `rebuild --projection <name>`                               | same — rebuilds without appending; one projection; unknown name refused with the available list                |
| `projection show`                                                      | same — asserts it does **not** rebuild (this was a live defect, `BP-051`)                                      |
| `context plan`                                                         | same — success, missing file, non-array, unknown mode, `reuse` refused, no ledger write                        |
| `residual list`                                                        | same — answers on an empty ledger                                                                              |
| `reflection run`                                                       | same — missing flag, unknown residual                                                                          |
| `asset list / inspect / contest / disable / restore / fork / activate` | same — full lifecycle against a real asset; missing reason; missing review file; unknown id                    |
| `history explain <id>`                                                 | same — real ancestry chain; unknown id refused                                                                 |
| `privacy purge <scope>`                                                | same — `--session <id>` per Correction Pack §4.5; both flags refused; preview deletes nothing; confirm deletes |
| `doctor`                                                               | same — passes healthy; exits 6 and names the failing `projection:` check when a lag is injected                |
| `legacy patterns / pattern / convert`                                  | same — lists inferred material, converts to a candidate, refuses a non-pattern event                           |

**P1 remaining:** `legacy anomalies` (partial), `lock inspect`, `lock clear-stale`,
`backup list` — all now have at least a smoke-level assertion. Issue 085's
report _path_ is still not implemented and remains registered.

**Stated boundary:** the CLI composition root always builds a local `OWNER`
writer with the full scope list, so a permission _refusal_ is not reachable
through the command line. That path is covered at the unit and service layers;
the boundary is asserted in the test file itself so the gate cannot claim a
coverage it does not have.

## 5. Replay suite

`pnpm test:replay` — **PASS**, 6 tests, 1 file.

The golden fixture's expected state is written **by hand from the reducer
source**, not recorded from a run, so a reducer change that alters it must be
explained rather than absorbed by regenerating the file.

## 6. Regression suite

`pnpm test:regression` — **PASS**, 7 tests, 1 file.

It contains only the named regressions that had **no** equivalent elsewhere:
reflection runaway (Bible 055) and agent-cursor integrity (a cursor past the
ledger head, and a cursor that moves backwards). The remaining eleven of
INC-001 §9.2's list are mapped to their existing files in the test file's header
comment, so the mapping is auditable without duplicating the tests.

## 7. BP-049 — verification pipeline

**Status: closed.**

`pnpm verify` now runs the frozen eleven steps in order, each as a named script
so a reader can map a failure to a step without reading the script body:

```
1 runtime/version        pnpm verify:runtime      → node scripts/assert-runtime-pins.mjs
2 dependency/lockfile    pnpm verify:deps         → node scripts/assert-workspace-deps.mjs
3 lint                   pnpm verify:lint         → format + eslint + dependency-cruiser + both fixtures
4 typecheck              pnpm verify:typecheck    → tsc --build + tsc --noEmit + schema parity
5 unit tests             pnpm test:unit
6 integration tests      pnpm test:integration
7 replay tests           pnpm test:replay
8 regression tests       pnpm test:regression
9 build                  pnpm build
10 CLI smoke tests       pnpm smoke:cli
11 daemon smoke tests    pnpm smoke:daemon
```

The frozen order places `build` **after** the test layers, which is only sound if
the tests do not depend on `dist` freshness. They previously did — that is
`BP-049`. `vitest.config.mjs` now resolves **every** workspace package to its
source, so the tests exercise sources and the artifact smoke steps run real
processes against the build this run produced. The hazard is removed rather than
scheduled around.

`pnpm smoke:daemon` is new. The daemon's fail-closed startup had no executable
coverage anywhere in the chain: it now starts on a healthy store and reports
ready, and refuses a store with an injected fault that projection catch-up
cannot repair.

**Result:** `pnpm verify` → **EXIT 0**. 187 tests across 21 files
(unit 52 / integration 122 / replay 6 / regression 7), schema parity, all eight
Phase 1–5 scenarios, and the daemon smoke.

## 8. CI

| Runner           | Node      | Status                          |
| ---------------- | --------- | ------------------------------- |
| `ubuntu-latest`  | `22.13.0` | **PENDING** for this checkpoint |
| `windows-latest` | `22.13.0` | **PENDING** for this checkpoint |

The last exact-runtime evidence is run `34978723319` at `75b5d23`, which closed
Gate D for **Phase 4**. Nothing after that commit has pinned-runtime evidence.
The recovery has not pushed, so no new run exists — reporting these as anything
other than `PENDING` would be the failure mode this recovery exists to correct.

Pins are consistent and machine-checked by step 1 of `verify`: `.node-version`,
`.nvmrc`, `package.json#engines.node`, and `ci.yml`'s `setup-node` all agree on
`22.13.0`; `packageManager` and `engines.pnpm` agree on `11.19.0`.

Local verification ran on Node `v24.15.0`, which is **outside** the pinned range.
Step 1 prints that as a warning and does not fail, because refusing to verify on
any runtime but the pinned one would make the gate unusable locally; the exact
evidence is CI's job. `node:sqlite` remains experimental in `22.13.0` even
though the flag is no longer required.

Provider smoke remains a separate `workflow_dispatch` workflow, never a PR gate,
and requires no provider secrets.

## 9. Golden Fixture 01

**`WAITING_FOR_AUTHOR_SOURCE`.**

It was **not** synthesised. Bible §14 specifies a sanitised minimal event set for
the 《红色源代码：洪湖篇》 Production Card collaboration chain, including a
counterexample ("a real task where the user asks to skip the Production Card"),
and Bible §571 states the handling for exactly this situation: 「素材不足 →
请求补素材」. Inventing it would fabricate the author's history, which is the
act the migration rules forbid under another name.

It blocks Alpha exit criterion 11 (Golden Fixture 01 plus at least two weeks of
continuous real use). It does **not** block the recovery baseline.

## 10. RFC MISMATCH

Registered in `docs/RFC/RFC-0001.md`:

- `PHASE_LABEL_DRIFT_IN_RECOVERY_PROMPT` — the recovery prompt's §5.1 audit
  coverage follows the Correction Pack's phase numbering, which offsets the
  residual and reflection topics by one phase against the Bible. Every listed
  topic was audited; the matrix is keyed to the Bible.
- Pre-existing and unchanged: `ADR_NUMBER_COLLISION`,
  `SQLITE_BACKUP_API_VERSION`, `PHASE4_LABEL_DRIFT`,
  `ASSET_RESTORE_PERMISSION_SCOPE` (resolved), `LEGACY_INPUT_NOT_IN_REPOSITORY`,
  `LEGACY_ANOMALY_CLASSES_EXTENDED`, `OPEN GAP: CONFIGURATION_SURFACE`.
- Registered at `ded9ec6`: `LEGACY_PATTERN_TO_CANDIDATE_ASSET`,
  `GOLDEN_FIXTURE_01_ABSENT`, `DOCTOR_COVERAGE_VS_13_1`,
  `CLI_SURFACE_GAPS_VS_13`, `TEST_LAYER_STRUCTURE`.

## 11. Git state

| Item                     | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Starting HEAD            | `542481b` (tag `inc-001-baseline`)                          |
| Branch                   | `incident/inc-001-phase55-recovery`, created from `542481b` |
| `master` / `origin/main` | `15f6e2f`, untouched                                        |
| Pushed                   | no                                                          |
| Repository visibility    | `PRIVATE`, unchanged — `PUBLIC = NO`                        |

Commits are small and separately auditable, and use the Bible's §16 prefix
convention, which the pre-recovery branch did not.

## 12. Decision

```
RECOVERY BASELINE:   PASS
PHASE 6:             NO-GO
```

### Real remaining blockers to Phase 6

1. **Golden Fixture 01** — `WAITING_FOR_AUTHOR_SOURCE`. Blocks Alpha exit
   criterion 11; cannot be closed by the executing agent.
2. **Pinned-runtime CI** — no `ubuntu-latest` / `windows-latest` evidence on
   exact Node `22.13.0` for any commit after `75b5d23`. Requires an authorized
   push.
3. **Doctor coverage** — roughly five §13.1 responsibilities still have no
   check: `integrity_check`, migration-version compatibility, event-schema
   content_hash sampling, stale-snapshot and orphan-`projection_data`, and
   context-exposure orphans. The `config` check also still cannot fail.

Everything else the audit raised at HIGH or MEDIUM is either resolved or
recorded with a decision owner. Nothing was written as `PASS` that is not one.

## 13. Handoff

Per recovery prompt §24, the next agent should be able to reconstruct why each
repair was made. The chain is: `INC-001-partial-bible-execution.md` (what
happened and why) → `INC-001-bible-conformance-audit.md` (requirement, evidence,
status, severity, required action) → this gate (what was done, what remains) →
`docs/断点记录.md` BP-050/BP-051 (the defects, including the three the recovery
itself found) → the commits.

Start by re-running `pnpm verify` and confirming section 3's claim that no
invariant is violated. That claim is the entire basis for choosing REPAIR over
REVERT, and it is the one assertion in this document that would change the
recovery's shape if it turned out to be wrong.
