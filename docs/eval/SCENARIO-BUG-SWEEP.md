# Round 1 Scenario Bug Sweep

**Date:** 2026-09-18  
**Manifest:** `evals/scenarios/reentry-round1-scenarios.json`  
**Nature of evidence:** synthetic local fixtures and integration tests. No historical Honghu material was ingested and no real-model result is claimed.

Each scenario is recorded as initial state → expectation → action → observable outcome → verifier → residual → reflection → asset behavior → final state. `PASS (fixture)` means the representative implementation path ran and asserted; it does not mean a field experiment passed.

| Scenario                          | Initial state / expectation                                                    | Action and observable outcome                                                                                                          | Verifier / expected residual                                                       | Reflection / asset behavior                                                       | Status                            |
| --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| SC-01 repeated valid workflow     | Empty asset registry; repeated valid workflow should yield a useful lesson     | Two independent episodes produce a residual and candidate; later prompt exposes the active asset                                       | `evals/test/assets.test.ts`; direct event/projection assertions                    | Reflection proposes; validation runs; human hook confirms; active asset is reused | **PASS (fixture)**                |
| SC-02 one-off accident            | One correction, insufficient evidence                                          | Candidate is proposed only when the runtime has enough evidence; one episode stays unpromoted                                          | Asset test asserts no promotion and no human activation request                    | No automatic promotion; candidate remains non-active                              | **PASS (fixture)**                |
| SC-03 obsolete active rule        | Seeded active asset is contradicted by a changed preference                    | `full-stale-asset` exposes the seed and challenge path                                                                                 | Asset test asserts challenge event and active asset removal from future active set | Explicit human challenge; no silent compensation                                  | **PASS (fixture)**                |
| SC-04 irrelevant history          | Ledger contains unrelated history; current task should not retrieve everything | `assetExpectation: ignore` omits active asset context; planner still applies bounded budget                                            | Context planner unit tests and asset ignore assertion                              | No residual/reflection/asset from irrelevant material                             | **PASS (representative fixture)** |
| SC-05 simple task                 | Clean routine task with no surprise                                            | Oracle abstention scenario runs BASE/STATE/REFLECTION/FULL                                                                             | `evals/test/oracle.test.ts`; expected residual false and candidate false           | No reflection and no candidate asset                                              | **PASS (fixture)**                |
| SC-06 evaluateBy then success     | Expectation is missed at the timing boundary, eventual outcome later succeeds  | `tests/replay/async-02-evaluateby-then-success.replay.ndjson` is replayed twice                                                        | Async replay tests keep timing residual separate from outcome success              | Reflection may record the timing lesson; no automatic asset claim                 | **PASS (replay fixture)**         |
| SC-07 adapter/scaffold neutrality | Same core event semantics through adapter variants                             | Adapter conformance and neutrality suites execute against provider-neutral contracts                                                   | `tests/integration/adapter-conformance.test.ts`, `adapter-neutrality.test.ts`      | Core ledger/schema/provenance remain adapter-independent                          | **PASS (integration fixture)**    |
| SC-08 wrong runtime/PATH/config   | Canonical check is run under an invalid environment                            | Node 24 is rejected by the canonical pin; foreign-cwd cycle check resolves correctly; gate tests reject missing command and bad format | `tests/regression/runtime-pins.test.mjs`, `gate-runner.test.ts`                    | Gate fails closed; no result is promoted as valid                                 | **PASS (negative controls)**      |
| SC-09 interrupted restart         | Durable ledger contains committed work and an interrupted boundary             | Crash-recovery and replay scripts rebuild/resume without rewriting raw events                                                          | `pnpm phase1:crash`, replay suite, INC-001 regression suite                        | Derived state catches up; duplicate raw history is not silently created           | **PASS (representative fixture)** |
| SC-10 corrected derived state     | Projection is stale or derived value is wrong; raw event remains authoritative | Append correction, rebuild projection, compare state and raw history                                                                   | Projection/rebuild integration and replay tests                                    | Reflection/residual records the mismatch; no raw overwrite                        | **PASS (integration fixture)**    |
| SC-11 privacy purge               | Session data and derived asset provenance are present                          | Dry-run is read-only; confirmed purge removes scoped history and invalidates derived rows                                              | Maintenance, Phase 4 asset, Phase 5 review, and operator tests                     | Purge is explicit and doctor is rerun; no hidden deletion claim                   | **PASS (integration fixture)**    |
| SC-12 wrong/stale active asset    | Active asset is stale and a counterexample is supplied                         | Challenge path records a contest and prevents further default exposure                                                                 | Asset lifecycle and operator-surface tests                                         | Human decision is required; stale asset does not become silently authoritative    | **PASS (fixture)**                |

## Executed representative suites

The current re-entry run produced:

- `pnpm test:evals`: **60/60 tests passed** across 7 files, including the unknown-verifier negative control.
- `pnpm test:integration`: **200 passed, 18 skipped by existing conditions**.
- `pnpm test:replay`: **15/15 passed**.
- `pnpm test:regression`: **32/32 passed**.
- `pnpm typecheck`: **passed**.
- `pnpm audit:registries`: **passed**.

The new machine-load test confirms that the ten-episode Round 1 manifest is valid, synthetic, unique, and contains explicit asset expectations. The manifest is a readiness fixture; it is not a substitute for V1/V2/V2X real-model execution.

## Remaining scenario risks

1. No scenario above is evidence from a real provider or the historical corpus.
2. Node 22.13.0 has not run this current branch locally; the canonical Node 24 run correctly refuses before full verification.
3. A valid-but-lagging projection and a full independent real-world verifier still need dedicated empirical runs.
4. GF01 remains waiting for a bounded author-approved historical source chain.
