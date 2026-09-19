# Phase 6V Empirical Report

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief, 2026-09-18.
**Phase 6V:** **INCOMPLETE.** The empirical rungs §6 requires have not run.
**Alpha release:** `NO-GO`, unchanged, and nothing here is evidence towards it.

## Re-entry addendum — 2026-09-18

The empirical conclusions above remain unchanged: V1, V2, V2X, and real-model
task execution have not run. During Codex re-entry, the evaluator was repaired
to exercise the reusable-asset lifecycle in synthetic tests. That closes a
harness-readiness defect; it does not turn the old scripted runs into field
evidence or authorize Alpha. See `docs/eval/EMPIRICAL-READINESS.md` and
`docs/eval/SCENARIO-BUG-SWEEP.md` for current status.

---

## 0. The report in one paragraph

Phase 6V set out to answer whether Praxis is useful, where it is not, and where
it does harm. **Those questions are not answered.** What happened instead is
that the instrument required to ask them was built, the space to be measured was
made explicit, the accumulated defects were given structure, and real long-term
material was identified. Six of the seven outputs §22 demands exist. **One does
not: there is no measurement of the runtime's behaviour on a real task.** This
report says so in the place where a result would go, rather than producing a
result-shaped document.

## 1. Scope actually covered

| §6 rung                                 | Required                              | State                                                                                                 |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **V0** Adapter reality                  | real provider through the 6B boundary | **RUN, on the development runtime** — nine scenarios, nine of nine matched. Not on the pinned runtime |
| **V1** Low-risk reversible field        | measure over-intervention             | **NOT RUN** — harness built, scenario written, no live subject                                        |
| **V2** Externally verifiable structured | three verifier classes                | **NOT RUN** — `MR-03` outstanding                                                                     |
| **V2X** Cross-provider / cross-scaffold | ≥2 configurations                     | **NOT RUN** — needs the harness plus a second subject                                                 |
| **V3** Long-term continuity             | real long history                     | **NOT RUN** — material identified and registered; nothing ingested                                    |
| **V4 / V5 / V6**                        | not executed this round               | **NOT RUN**, as §6 directs                                                                            |
| **Golden Fixture 01**                   | after V2/V2X                          | **`WAITING_FOR_AUTHOR_SOURCE`**                                                                       |

## 2. Practice Freeze

**Respected.** No file under `packages/`, `apps/`, `migrations/` or `schemas/`
was modified in Phase 6V.

Two things were added that touch the build:

- `evals/` — a new top-level directory, **not** a workspace package, so it is
  outside `pnpm -r build` and cannot break the runtime's build. See
  [`ADR-0015`](../ADR/ADR-0015-evaluation-harness-boundary.md).
- `test:evals` appended to `verify:chain`, and `evals/**/*.ts` added to
  `tsconfig.json`'s include. Both are verification reliability, which §1 lists
  as permitted.

Two `RFC MISMATCH` entries already registered were **not** modified, and no new
one was needed: nothing was changed that the Bible constrains.

## 3. V0 — adapter reality

Run before this session; reported in full in [`6V-0-RESULTS.md`](6V-0-RESULTS.md).
Summary of the summary:

- Nine scenarios, nine matched the expectation frozen before the call. Nothing
  observed fell outside the twelve error kinds, and `unknown_external_failure`
  was never used as a bin.
- **It is not closed.** It ran on Node **24.15.0** with `runtimeDirty: true`.
  §A3 forbids treating that as equivalent to the pinned runtime, and BP-061 and
  BP-063 are both what happens when it is.
- **Not repeated in this session.** A pinned-runtime, clean-tree repetition is
  the cheapest outstanding item in the phase and remains owed.
- Two kinds were never exercised against reality (`transient_provider_failure`,
  `permanent_provider_failure`), and the quota/config gap the OSS scan flagged
  is **untested rather than closed**.

## 4. What was actually built

This is what Phase 6V produced, and it is the reason the rungs above are
`NOT RUN` rather than `FAILED`.

### 4.1 An evaluation harness

[`../../evals/`](../../evals/) — a separate package depending on the runtime,
which nothing in the runtime may depend on. The boundary is enforced twice: a
dependency-cruiser rule and a source-text scan that cannot fail open. Decision
recorded in [`ADR-0015`](../ADR/ADR-0015-evaluation-harness-boundary.md).

Three parts matter more than the rest:

- **A rate that cannot report a value it did not measure.** Zero detected
  residuals is exactly what V1 hopes to see, and it is also what a broken run
  produces. A zero denominator yields `unscored`, never `0.000`.
  `evals/test/oracle.test.ts` asserts concretely that the BASE arm — which
  implements no residual detection — reports `unscored` and not zero. The OSS
  scan found Inspect Evals fixed this same defect four separate times.
- **A JSON-Schema validator that throws on any keyword it does not implement**,
  so it cannot pass by not looking. Written instead of adopting `ajv` for that
  reason.
- **An oracle path.** 21 assertions driving all four ablation arms with a
  scripted subject — no model, no network, no credential. SWE-bench's `--gold`,
  Terminal-Bench's `--agent oracle`, Inspect Evals' `mockllm`. The scan's
  sharpest finding is why it exists: **no project in it found its own defect by
  looking at its score.**

### 4.2 Six ablation arms

[`ABLATION-PLAN-AND-RESULTS.md`](ABLATION-PLAN-AND-RESULTS.md). The arms _are_
the runtime's existing phase boundaries — `Phase2Runtime` → `Phase3Runtime` →
`Phase4Runtime` — so **no runtime file was modified to run an ablation**, and the
arms differ by which product code paths execute rather than by a harness-side
reimplementation.

**No ablation has been run**, and `MECHANISMS_NOT_YET_WIRED` names why in every
manifest the harness writes: asset promotion is not implemented, so
`assetFeedback` is unexercised and `full` differs from `reflection` by candidate
creation alone. Arms E and F currently assemble the same runtime as D.

### 4.3 Fault injection

[`VERIFIER-RELIABILITY-REPORT.md`](VERIFIER-RELIABILITY-REPORT.md) — 9 of §3's 13
injections covered, 3 implemented this phase, 1 not implemented with the reason
stated. The most valuable is BP-062's trap made permanent: a fixture proves that
**Vitest silently ignores a top-level `testTimeout`**, so the mistake that
shipped cannot be made again without a red test.

### 4.4 The corpus

[`CORPUS-I-REGISTER.md`](CORPUS-I-REGISTER.md) — the owner supplied two
long-cycle interaction archives. One is an index with no content. The other is
**11,411 de-identified interaction records over 2026-07-13 → 2026-09-08**, with
`result_status` (4,602 failures, 962 verified, 41 adopted), 5,999 artefact
records, and a `candidate_register` of **2,050 rows each carrying a human
accept/reject disposition**.

That last file is the strongest external verifier this project has ever had
access to: an independently authored record of which candidates a human kept,
made before Praxis existed. It is registered and **not ingested**.

## 5. The three questions §0 asked, answered honestly

| Question                                           | Answer                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「已经实现的东西到底有没有用？」                   | **Unknown.** No run has measured it.                                                                                                                                                     |
| 「在哪些条件下会失效？」                           | **Partly known, from the harness not the product.** The failure families give the _mechanisms_; the coverage matrix gives the _untested regions_. Neither is a measurement.              |
| 「换模型、换系统、换场景、换用户后还能不能成立？」 | **Unknown.** `6V-2X` has not run and only one scaffold exists.                                                                                                                           |
| 「我们的测试装置本身是否可信？」                   | **Better than yesterday and not proven.** §3's injections, the oracle path, the throwing validator, the boundary scan, and three of the harness's own defects found during construction. |
| 「哪些兼容性问题现在尚未被看见？」                 | **Now enumerated.** The coverage matrix and compatibility surface make the untested space explicit for the first time.                                                                   |

## 6. Defects found in Phase 6V

Recorded so that the phase's yield is not only documents.

| Where                         | What                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evals/src/runner.ts`         | `buildContextPlan({mode:"reuse"})` threw on every episode; an empty `catch {}` reset the exposure count to zero, so the STATE arm **silently ran as BASE** while every test was green |
| `evals/src/run.ts`            | `contextItemsExposed` read from the post-call observation, which always held `0`                                                                                                      |
| `evals/src/runner.ts`         | A comment stating an error was "recorded, not swallowed" while nothing was recorded                                                                                                   |
| `evals/test/boundary.test.ts` | An anti-vacuity threshold invented on the spot (">50 files") and wrong — replaced with named-file assertions, because §18 forbids inventing thresholds                                |
| this session's shell          | `pnpm verify \| tail && echo $?` printed `GATE_EXIT=0` for a run the gate had correctly marked FAIL                                                                                   |

All five are `VF-01`. Four of the five were _written in this phase_, three of
them by the author of the family document. That is the finding: the mechanism is
not historical, it is the default behaviour of a check that has not been asked
to fail.

## 7. Outputs

§21's list, with state:

| Required                                          | State                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `docs/eval/PHASE-6V-EMPIRICAL-REPORT.md`          | this file                                                                             |
| `docs/eval/SCENARIO-COVERAGE-MATRIX.md`           | written                                                                               |
| `docs/eval/COMPATIBILITY-SURFACE-MAP.md`          | written                                                                               |
| `docs/eval/ABLATION-PLAN-AND-RESULTS.md`          | written — plan only, results empty                                                    |
| `docs/eval/VERIFIER-RELIABILITY-REPORT.md`        | written                                                                               |
| `docs/eval/OSS-EVAL-COUNTEREVIDENCE-SCAN.md`      | written — 13 records, 12 documented cases of a benchmark catching its own measurement |
| `docs/engineering/DEBT-RECONCILIATION.md`         | written                                                                               |
| `docs/engineering/FAILURE-FAMILIES.md`            | written — 6 families over 64 entries                                                  |
| `docs/engineering/RFC-MISMATCH-RECONCILIATION.md` | written                                                                               |
| `docs/release/PRE-RELEASE-GAP-MAP.md`             | written                                                                               |
| ADR — Evaluation Harness Boundary                 | written — `ADR-0015`                                                                  |

Not on §21's list and produced anyway:
[`CORPUS-I-REGISTER.md`](CORPUS-I-REGISTER.md) and
[`../engineering/ARCHITECTURE-SELF-REVIEW.md`](../engineering/ARCHITECTURE-SELF-REVIEW.md).

## 8. What would close Phase 6V

In dependency order. The first three need no credential.

1. **Implement asset promotion in the harness** so `assetFeedback` is exercised
   and arms E and F differ from D. Without this, §2's ablation cannot be run
   even with a model.
2. **Run V0 again on Node 22.13.0 with a clean tree.** Nine scenarios, one
   command — but **not on this machine**, which has no 22.13.0. Needs CI or
   another host. See `BP-065`.
3. **Run `SC-01` and `SC-12`** — stale preference and obsolete workflow — which
   need no credential once the seeding exists.
4. **Supply a provider credential.** Then V1, V2, V2X and the ablation all
   become runnable, and the first real measurement of the runtime can exist.
5. **Locate Golden Fixture 01 in the 洪湖篇 archive.** Bounded and mechanical;
   the source is now known to be nearby rather than assumed.

## 9. Verdict

```
PHASE 6V IMPLEMENTATION       = SUBSTANTIAL
PHASE 6V EMPIRICAL VALIDATION = NOT RUN
PHASE 6V                      = INCOMPLETE

PHASE 6 FINAL                 = NOT REACHED
GOLDEN FIXTURE 01             = WAITING_FOR_AUTHOR_SOURCE

READY FOR RELEASE ENGINEERING = NO
FORMAL OPEN-SOURCE RELEASE    = NOT STARTED
ALPHA                         = NO-GO
```

**`READY FOR RELEASE ENGINEERING = NO`** is the load-bearing line. §22's
condition is not that Praxis works everywhere; it is that the project knows
where it works, where it does not, and where nothing is known. Two of those
three are now written down. The first is not, and no quantity of documentation
substitutes for it.

**Next:** STOP. Waiting for author review, a provider credential, and a decision
on whether the CORPUS-I archive may be used.
