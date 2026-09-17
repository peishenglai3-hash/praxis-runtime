# Phase 6 Gate Report — EPIC-007 hardening (Phase 6A)

**Status:** `COMPLETE` — code and verification.
**Behavioural validation:** **not attempted.** See
[`PHASE-6-FIELD-VALIDATION-PLAN.md`](./PHASE-6-FIELD-VALIDATION-PLAN.md).
**Alpha release:** `NO-GO`. Unchanged by this gate.
**Baseline:** `phase5-baseline-2026-09-17` (`ca4d3d6`).
**Branch:** `phase6/epic-007-hardening`.
**Authority:** owner decision, 2026-09-17.

## 1. What was in scope, and what was not

The owner froze Phase 6A as **hardening and re-verification of the Bible's
EPIC-007 asset and promotion mechanism**, with this charter:

> 允许开始 Bible 已冻结的 EPIC-007 / Asset & Promotion mechanism: ReusableAsset
> contract, lifecycle, provenance validation, promotion gate, human
> confirmation, challenge, disable / restore, fork, history explanation.

Explicitly forbidden, and none of it was done: automatic skill evolution;
automatic institutional promotion without human confirmation; a learned
promotion policy; new agent roles; provider-specific production adapters;
Phase 7+ features; release packaging.

The delivery order this phase follows is itself a registered deviation from
Bible section 15 — see `RFC MISMATCH: PHASE6_DELIVERY_ORDER` and `BP-057`. The
Bible puts EPIC-010 in Phase 6; the owner has put the asset mechanism first.

## 2. Result

**EPIC-007 conforms.** Full matrix in
[`PHASE-6A-EPIC-007-CONFORMANCE.md`](./PHASE-6A-EPIC-007-CONFORMANCE.md).

```
Issues 060-066        PASS   (each on implementation + test evidence)
EPIC Gate             PASS   (agent cannot promote; 100% active provenance; no lost update)
Risk mitigation       PASS   (optimistic locking, exposure lineage, exclusion)
CRITICAL findings     0
HIGH findings         0
Defects found         0
```

The EPIC Gate's 「任何 Agent 不能直接 promote」 is enforced twice and
independently: `authorizeHumanControl` on the runtime use case, and
`authorizeEventAppend` on **every store write** for `asset.activate`, which no
declared scope can bypass.

## 3. What changed

| Change                                                                                                                 | Kind                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `docs/RFC/RFC-0001.md`, `docs/断点记录.md` — `RFC MISMATCH: PHASE6_DELIVERY_ORDER`, `BP-057`                           | Registration before construction |
| `tests/integration/phase6-asset-projection.test.ts` — 3 tests comparing the asset catalog against the asset projection | Verification                     |
| `docs/断点记录.md` — `BP-058`, three falsified audit suspicions                                                        | Method record                    |
| This report and the field validation plan                                                                              | Gate record                      |

**No production code changed.** No contract, migration, schema or CLI surface
was altered. If the phase had found a defect it would have changed code; it
found none, so the honest output is the verification.

## 4. Verification

```
pnpm verify → EXIT 0
  208 tests across 24 files
  unit 58 / integration 128 / replay 15 / regression 7
  schema parity, all eight Phase 1-5 scenarios, CLI and daemon smoke
```

(An earlier draft of this report said 207. It was written before the run and
was wrong by one; the figures above are from the run.)

Local runtime is Node `v24.15.0`. **No exact Node.js `22.13.0` runner evidence
exists for this branch.** That evidence is the Phase-5 public baseline / merge
gate and remains `PENDING`; it is not the Phase 6 engineering-start gate, and
this report does not treat it as one.

## 5. Open items carried forward

Recorded, not absorbed. None blocks Phase 6B from a Bible-conformance
standpoint; the first two are the Phase-5 baseline's own outstanding items.

| #   | Item                                                                                                         | Owner                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | Issue 081's doctor `cursors` / `context` scope — Phase 5 is `PARTIAL` on it                                  | owner; declined for the limited repair            |
| 2   | Bible section 5.4 event taxonomy — nine names absent or renamed — `RFC MISMATCH: EVENT_TAXONOMY_VS_5_4`      | owner                                             |
| 3   | Golden Fixture 01 `WAITING_FOR_AUTHOR_SOURCE` — blocks Alpha exit criterion 11                               | owner; must not be synthesised                    |
| 4   | Secret scanning, push protection and private vulnerability reporting all **disabled** on a public repository | owner; GitHub settings change needs authorization |
| 5   | No exact Node `22.13.0` CI evidence for any commit after `15f6e2f`                                           | requires an authorized push                       |

## 6. Statement about what this gate is not

This gate says the asset and promotion mechanism **does what the Bible says,
under test**. It says nothing about whether the mechanism is right for real
work: whether the promotion thresholds are well chosen, whether
`exposureInfluenced` is being marked honestly, whether independent episodes are
genuinely independent in a live collaboration, or whether the lifecycle's
restore edges are used as intended.

Those are empirical questions about a running system in a real field, and they
are not answerable by a test suite. That is why Phase 6A ends with a field
validation plan rather than with a release, and why the plan is ordered by
consequence and reversibility rather than by convenience.

**Phase 6B (EPIC-010 Adapter Boundary) does not start until the owner decides
it does. Alpha release stays `NO-GO`.**
