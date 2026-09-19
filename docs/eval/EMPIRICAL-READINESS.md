# Empirical Validation Readiness

## Final-freeze addendum — 2026-09-19

The candidate branch's exact Node `22.13.0` CI run `35422401720` passed on
Ubuntu and Windows at clean commit `9da7f28`, with all 11 stages complete.
This closes the canonical runtime/verification prerequisite only. It does not
change the status of V1, V2, V2X, real Asset benefit or GF01 below.

**Date:** 2026-09-18  
**Scope:** prepare BASE / STATE / REFLECTION / FULL for the next empirical round; do not fabricate measurements.

## Arm readiness

| Arm        | Structural difference                                                                                           | Current evidence                                          | Readiness                       |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| BASE       | scripted subject with no durable state/reflection mechanism                                                     | Oracle suite and abstention scenario                      | **READY for harness execution** |
| STATE      | ledger, projections, bounded ContextPlanner, no residual/reflection/asset promotion                             | evaluator runner plus unit/integration tests              | **READY for harness execution** |
| REFLECTION | state plus expectation/residual/reflection decisions; no reusable-asset activation                              | oracle and residual/reflection suites                     | **READY for harness execution** |
| FULL       | state + residual/reflection + candidate/validation + human-confirmed asset lifecycle and challenge/ignore paths | 5 dedicated asset tests, integration asset/operator tests | **READY for harness execution** |

The four minimum comparison arms are now behaviorally distinct in the evaluator. `full-no-asset` and `full-stale-asset` remain additional diagnostic arms; they are not silently substituted for the minimum set.

## Executed readiness evidence

- Scenario manifest load: **PASS** for 10 synthetic Round 1 episodes.
- Eval suite: **60/60 PASS**, including the unknown-verifier negative control.
- Integration suite: **201 PASS, 18 existing skips** in the latest local development run.
- Replay suite: **15/15 PASS**.
- Regression suite: **99 tests PASS across 14 files** in the latest local development run.
- Typecheck: **PASS**.
- Registry audit: **PASS**.
- Asset lifecycle: candidate → validated → explicit human confirmation → active → later reuse/ignore/challenge **PASS in harness fixtures**.

The canonical gate was also executed on the final current-HEAD commit `45e2300`
in GitHub Actions run `35355177455`, on exact Node `22.13.0` Ubuntu and Windows
runners. Both machine-readable artifacts report `PASS`, `complete: true`, all
11 stages with `exitCode: 0`, and `notRun: []`. This closes the pinned-runtime
gate; it does not turn the local Node 24 development counts above into
canonical release evidence.

These are readiness and mechanism tests. They are not V1/V2/V2X measurements and do not establish that Praxis improves a real task.

## Runtime path

| Environment                   | State                                                                                                      | Meaning                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Local Windows                 | Node `24.15.0`; canonical `pnpm verify` is rejected by the runtime pin check                               | **Known negative control**, not a supported result |
| Local Windows Node `22.13.0`  | Not installed/found                                                                                        | **Pending**                                        |
| GitHub Actions Ubuntu/Windows | Workflow pins Node `22.13.0`; run `35355177455` passed final current-HEAD commit `45e2300` on both runners | **PASS for the pinned runtime gate**               |
| Provider-backed V1/V2/V2X     | No current run in this round                                                                               | **Not executed**                                   |
| Historical GF01               | Source chain not established and archive licence/consent unverified                                        | **Waiting for author source**                      |

## Conditions for the next empirical round

1. Preserve the current machine-readable Node 22 gate artifacts and commit SHA as the canonical runtime baseline.
2. Preserve machine-readable manifests and commit SHA for every empirical arm.
3. Run the four minimum arms against the same scenario version and independent verifier.
4. Keep synthetic harness results separate from real-provider and historical-corpus results.
5. Do not upload GF01 or the historical corpus without provenance, consent, licence, and re-identification review.

## No fabricated result

V1/V2/V2X remain **unrun**. A readiness PASS means the executable path and evidence boundaries are present; it is not an empirical outcome.
