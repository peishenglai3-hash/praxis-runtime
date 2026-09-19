# Verifier Reliability Report

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §3 (`False Green 专项治理`) and §4 (`Gate Runner 可信性`).
**Companion:** [`../engineering/FAILURE-FAMILIES.md`](../engineering/FAILURE-FAMILIES.md) §VF-01.

Every claim below is a claim about the _measurement apparatus_, not about the
runtime. The runtime's own verification is a separate matter and is not
re-examined here.

## Re-entry addendum — 2026-09-18

This report contains the pre-reentry fault-injection inventory. BP-064 and
BP-065 have now been repaired and regression-tested. BP-066 additionally
closed a verifier-boundary defect: an independent `null` verdict is now kept
unadjudicated rather than converted into a failure/residual. The current canonical
runtime check rejects local Node 24.15.0, as it must; the historical “`pnpm
verify` PASS, Node 24.15.0” line below is not current evidence and must not be
used for freeze. A real wrong-runtime injection using a separately installed
unsupported Node binary remains unrun; the parser/negative-control coverage is
not being overstated as that experiment.

---

## 1. What the brief asked for, and what exists

§3 lists thirteen fault injections. Each is either implemented, already covered
by an existing suite, or explicitly not implemented. Nothing in this table is
"partially done".

| #   | Fault to inject                                 | State                        | Where                                                                                                                                                     |
| --- | ----------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 错误 Node 版本                                  | **Partial / parser control** | `runtime-pins.test.mjs` proves Node 24.15.0 is rejected by canonical verification; a separate unsupported binary gate run remains unimplemented (see §4)  |
| 2   | 错误 PATH                                       | Covered                      | `gate-runner.test.ts` — `envWithoutPath()` strips every case variant of `PATH` and `npm_execpath`; a stage whose binary is missing fails                  |
| 3   | Windows `Path` / `PATH` case difference         | Covered                      | same file — the helper filters case-insensitively, which is the fix for a test that had silently acquired two `PATH`s                                     |
| 4   | 错误 config 位置                                | **Implemented, Phase 6V**    | `fault-injection.test.ts` — a fixture with `testTimeout` at the top level is run and must fail; the trap is now permanent                                 |
| 5   | stale projection                                | Partial                      | `inc-001-regressions.test.ts` covers stale and backwards cursors; a _lagging_ projection (cursor valid but behind) is not injected                        |
| 6   | stale cursor                                    | Covered                      | `inc-001-regressions.test.ts` — cursor past ledger head, cursor moving backwards, cursor advancing                                                        |
| 7   | 错误 content hash                               | **Implemented, Phase 6V**    | `fault-injection.test.ts` — payload tampered behind the API, `getById` must throw, with an untampered control beside it                                   |
| 8   | malformed fixture                               | **Implemented, Phase 6V**    | `fault-injection.test.ts` — six malformations, each refused at load                                                                                       |
| 9   | 错误 provider capability                        | Covered                      | 6V-0 `6V0-04`, plus the adapter conformance suite; `negotiateCapabilities` refuses fail-closed                                                            |
| 10  | unsupported OS assumption                       | **Implemented, Phase 6V**    | `fault-injection.test.ts` — the POSIX ancestor walk asserted from Windows, **with the defective algorithm reproduced beside it** and required to disagree |
| 11  | timeout actually ignored                        | **Implemented, Phase 6V**    | same case as #4: the fixture proves the option is inert when mis-placed                                                                                   |
| 12  | deliberately failing format / type / test stage | Covered                      | `gate-runner.test.ts` — real Prettier over a genuinely unformatted file; a stage that prints the reassuring line and exits 1                              |
| 13  | pipeline exit-code substitution                 | Covered                      | `gate-runner.test.ts`, the BP-060 shape itself                                                                                                            |

**The original 9-of-13 accounting is a pre-reentry snapshot.** Current status
is 9 covered, 3 implemented in the original phase, and 1 partial parser-level
control; the separately installed wrong-runtime execution remains open.

**Two further defects were found after this table was written**, by the
compatibility probe, and both are `VF-01`:

- **`BP-065`** — `assert-runtime-pins.mjs` parses `engines.node`'s upper bound
  with a three-component regex, so `<23` yields `undefined` and the runtime bound
  check never runs. Observed printing `PASS` on Node 24.15.0, outside the pinned
  range, exit 0. **This is the check whose entire purpose is to notice a wrong
  runtime.** §3's instruction would have found it on the first day.
- **`BP-064`** — `assert-cycle-detected.mjs` resolves its tool against
  `process.cwd()`, so it passes only because `runStage` happens to set
  `cwd: root`.

---

## 2. The gate runner, held to its four properties

§4 asks that the gate be trustworthy _structurally_ rather than by the
operator's discipline — 「不得仅依赖执行者纪律，例如「以后不要 pipe 到 tail」」.

`scripts/gate.mjs` provides each required property as a property, not a habit:

| §4 requirement                                   | How it is provided                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 直接取得真正 child process exit code             | `spawnSync(pnpm, ["run", stage.id], { shell: false })`; the stage's own `status` is the result               |
| 不允许 shell pipeline 偷换 exit code             | No shell is ever spawned. There is no pipeline to substitute a status                                        |
| 任一 mandatory stage FAIL → overall FAIL         | Any non-zero stage fails the run and stops it                                                                |
| machine-readable result                          | `test-results/gate-result.json`, written on **every** path including refusal                                 |
| human-readable result                            | the per-stage table printed at the end                                                                       |
| runtime version / commit SHA / OS / architecture | in the artifact                                                                                              |
| gate stages                                      | in the artifact, with labels                                                                                 |
| start/end timestamps                             | in the artifact                                                                                              |
| failing stage                                    | named, and the stages after it are marked `NOT-RUN` rather than omitted                                      |
| CI 与 local gate 尽量使用同一套语义              | both consume `test-results/gate-result.json`; CI uploads it as an artifact and does not read the status line |

**A stage whose process cannot be spawned is `HARNESS`, never a pass.** That
case is the one that matters most: `spawnSync` returns `status: null` when the
binary is missing, and `null` is falsy, which is exactly how "we could not run
anything" reads as "nothing was wrong".

**The plan check.** The runner refuses to start if its own stage list disagrees
with `package.json#scripts["verify:chain"]`. A stage cannot be silently dropped
from one without the other.

---

## 3. Negative controls added in this phase

### 3.1 BP-062's trap, made permanent

The single most valuable case, because it is the failure that actually shipped.
A fixture writes `testTimeout: 60_000` at the **top level** of a Vitest config —
where Vite reads and Vitest does not — and runs a test that sleeps 5.5 s. If
Vitest honoured the option the test would pass. It must fail.

**Observed:** the fixture exits non-zero. Vitest genuinely ignores the top-level
placement.

This matters beyond the one bug. The config file that contained the mistake
looked correct, ran without complaint, and was reviewed. The only thing that
found it was a probe that _tried to fail_. Had the probe not been written, the
project would have shipped with a 5000 ms budget nobody had chosen, and the
first CI run on a cold Windows runner — which is precisely what happened — would
have timed out seven integration tests with no explanation available.

### 3.2 The validator that refuses to under-validate

`evals/src/schema.ts` implements a small subset of JSON Schema and **throws on
any keyword it does not implement**. An unimplemented keyword is a hard error,
not a skipped constraint, so the failure mode is "the harness refused to run"
rather than "the harness said PASS".

Written instead of adopting `ajv`. `ajv` is careful, but a general-purpose
validator's contract is "validate the parts I understand", and that contract is
VF-01 one level down. The supply-chain reason is secondary.

**17 negative controls** in `evals/test/schema.test.ts`, including the exact
6V-0 defect (an undeclared top-level key) and a check that `format` is annotated
rather than asserted — stated as a test so a reader who doubts the claim can see
it is deliberate.

### 3.3 The boundary scan that cannot fail open

`evals/test/boundary.test.ts` enforces the ADR-0015 direction by reading source
text, not by resolving a module graph. A misconfigured resolver makes
dependency-cruiser report "no violations"; a literal import path cannot lie.

It carries its own control: four planted import forms that the pattern must
match, and two runtime imports it must not. Without that, a typo in the regex
would make the suite pass on every file in the repository.

### 3.4 The oracle path

`evals/test/oracle.test.ts` — 21 assertions driving all four ablation arms with
a scripted subject. No model, no network, no credential. This is SWE-bench's
`--gold`, Terminal-Bench's `--agent oracle`, Inspect Evals' `mockllm`.

The counterevidence scan's sharpest finding is why it exists: **no project in
the scan found its own defect by looking at its score.** Every documented case
came from a step separate from the run.

### 3.5 The empty-denominator control

`evals/src/rate.ts` and the oracle suite assert that a rate with no
opportunities reports `unscored`, and that `formatRate` never renders it as
`0.000`. The oracle test asserts concretely that the BASE arm — which implements
no residual detection — reports `falseResidualRate` as `unscored` and not as
zero.

This is the defect the scan found Inspect Evals had fixed four separate times,
once in `sycophancy` where every model scored `0.0` "through an unreachable
denominator, and nothing raised".

---

## 4. What is not implemented, and why

**Wrong Node version (#1).** The brief asks for a fault injection that runs the
gate under a node the project does not support. This is _not_ implemented, and
the honest reason is that every implementation available to me was worse than
the gap: running the real gate under Node 24 costs about two minutes and, in the
current tree, Node 24 is what the developer already runs — so the injection
would not inject anything. Doing it properly means invoking the gate under a
node binary that is not the running one, which needs a second runtime installed
and pinned, which §K's stop-scope and the Practice Freeze both push to Release
Engineering.

What exists instead is weaker and should not be read as covering it:
`scripts/assert-runtime-pins.mjs` fails when the three pin declarations
disagree, and CI runs on exactly 22.13.0. Neither injects a wrong version.

**A lagging projection (#5).** Stale and backwards cursors are covered; a
projection whose cursor is valid but simply behind the ledger is not. That is
`CF-01`'s remaining risk, and the runtime's `catchUp` returns a status rather
than throwing, so the injection would need a caller that reads the status — the
harness, not the runtime.

---

## 5. False greens remaining in the apparatus

Stated as residual risk rather than as a count. A number here would be invented.

1. **A missing check is invisible to every test.** `fault-injection.test.ts` can
   only fault-inject checks that exist. BP-038 (an ACL change not mirrored into
   a schema) and BP-052 (four fixtures never ran) were both _absences_, and no
   amount of testing an existing check finds a missing one. The only
   countermeasure in the record is a reading of the requirement text against
   what exists — a human step, and `RB-01`'s subject.

2. **The environment can change under the test.** The Node-24 evidence in
   [`6V-0-RESULTS.md`](6V-0-RESULTS.md) is the live instance: the run was real
   and the environment made it non-transferable. Its own document says so.

3. **The gate's stage list can be right while a stage's _content_ is wrong.**
   The plan check verifies the twelve ids agree with `verify:chain`. It cannot
   check that `test:unit` runs the tests a reader would expect `test:unit` to
   run.

4. **A test can pass for a reason that is true but unintended.** Three instances
   were found in the new harness during this phase, listed in `VF-01`. All three
   shared one cause — an empty `catch {}` or a wrong field read — and none was
   visible in the test output.

---

## 6. Evidence

| Artefact                                       | Result                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm verify` (12 stages)                      | PASS, Node 24.15.0                                                |
| `tests/regression/gate-runner.test.ts`         | 8 tests                                                           |
| `tests/regression/fault-injection.test.ts`     | 12 tests                                                          |
| `tests/regression/inc-001-regressions.test.ts` | 9 tests                                                           |
| `evals/test` (4 files)                         | 53 tests                                                          |
| CI, Ubuntu + Windows at Node 22.13.0           | PASS on `6b7dcdc33804`; a Phase 6V re-run is owed                 |
| `npm audit` on the default branch              | 4 advisories (3 moderate, 1 low) — unchanged, Release Engineering |
