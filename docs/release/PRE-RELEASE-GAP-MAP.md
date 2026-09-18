# Pre-Release Gap Map

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §9 (`Compatibility 本轮边界`), §14
(`Release 阶段明确留白`), §15 (`正式开源技术开放阶段继续留白`), §20
(`Release Blocker 识别`).
**Status:** identification only. **Nothing here is scheduled and nothing here
authorises work.**

---

## 0. What this document is

§20 asks that every finding from Phase 6V be classified by **what it blocks**
before anybody decides to fix it, because 「「发现一个问题」=「现在立刻修」」 is
the reflex the classification exists to prevent.

§14 lists twenty-one things Phase 6V must **not** do — packaging, installers,
onboarding, a UI, auto-update, a plugin marketplace, a stable extension ABI,
binary signing, distribution mirrors, user documentation, tutorials, sample
projects, telemetry policy, support policy, triage policy, a compatibility
guarantee, a stable API guarantee. §15 adds fourteen more that must be done
_before_ a formal Release Candidate and explicitly **not** in this phase.

So this document does not plan any of that. It records, for each item, whether
Phase 6V has produced the _evidence or requirement_ that the later phase will
need — which is the only thing §14 says Phase 6V owes.

**A note on the standing decision.** The repository is public and, per
[`RFC-0001`](../RFC/RFC-0001.md) and the owner's 2026-09-17 ruling, that was
deliberate. §15 states the consequence plainly and this document takes it as
given: 「即使仓库已经 public，也不得把 Public Repository 等价为 Formal
Open-Source Release」. **Alpha release: `NO-GO`.** This document is not evidence
towards it and must not be quoted as such.

## 1. Findings, classified

### Blocks Phase 6 Final

| Finding                                                                                                                                        | Source                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 6V-1, 6V-2, 6V-2X have not run                                                                                                                 | [`SCENARIO-COVERAGE-MATRIX.md`](SCENARIO-COVERAGE-MATRIX.md) §1    |
| No ablation has been run; arms E and F do not differ from D                                                                                    | [`ABLATION-PLAN-AND-RESULTS.md`](ABLATION-PLAN-AND-RESULTS.md) §4  |
| 6V-0 is development-runtime evidence (`node 24.15.0`, `runtimeDirty: true`)                                                                    | [`6V-0-RESULTS.md`](6V-0-RESULTS.md)                               |
| Golden Fixture 01 — `WAITING_FOR_AUTHOR_SOURCE`                                                                                                | [`CORPUS-I-REGISTER.md`](CORPUS-I-REGISTER.md) §8                  |
| Real Asset benefit is not yet measured; synthetic candidate→validation→human-confirmation→active lifecycle evidence is not real pilot evidence | [`../eval/REAL-ASSET-EVIDENCE.md`](../eval/REAL-ASSET-EVIDENCE.md) |

### Blocks Pre-Release Compatibility Audit

| Finding                                                                                                         | Source                                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| macOS and arm64 are `UNKNOWN`, not "unsupported"                                                                | [`COMPATIBILITY-SURFACE-MAP.md`](COMPATIBILITY-SURFACE-MAP.md) |
| No experiment has run on the pinned runtime on either platform                                                  | coverage matrix §4 Q4                                          |
| The supported-provider matrix does not exist; provider-neutrality is a **contract** claim, not a coverage claim | `RFC MISMATCH` set; §8.9 of the brief                          |
| Shell sensitivity of `package.json` scripts is unmeasured under PowerShell and `cmd`                            | compatibility map §5                                           |
| Network-environment behaviour (proxy, offline, partial outage) is untested                                      | compatibility map §11                                          |

### Blocks Release Engineering

| Finding                                                                                                                                                    | Source                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RB-01` has the weakest mitigation of any family: no test, no gate stage, no artifact that fails when the requirements baseline is wrong                   | [`../engineering/FAILURE-FAMILIES.md`](../engineering/FAILURE-FAMILIES.md)                         |
| `npm audit`: 4 advisories (3 moderate, 1 low)                                                                                                              | gate report, Medium                                                                                |
| No install/packaging surface exists — `private: true`, workspace-internal only                                                                             | `package.json`                                                                                     |
| `run-manifest.v1.schema.json` is shared into the runtime's directory by path, not by dependency — the one place ADR-0015's direction could quietly reverse | [`../ADR/ADR-0015-evaluation-harness-boundary.md`](../ADR/ADR-0015-evaluation-harness-boundary.md) |

BP-049 is no longer a current Release Engineering finding: the author's
canonical eleven-stage order is implemented and regression-tested. Its
historical open state remains in the older RFC and breakpoint prose; the
current disposition is [`BP-049-CANONICAL-VERIFY.md`](../engineering/BP-049-CANONICAL-VERIFY.md).

### Blocks Alpha

| Finding                                                                                                         | Source                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `VF-01` — a verification defect has been produced in every phase since Phase 5, most recently three in this one | [`VERIFIER-RELIABILITY-REPORT.md`](VERIFIER-RELIABILITY-REPORT.md) |
| `MF-01` — the store can silently reduce raw material on a write that reports success                            | failure families §MF-01                                            |
| `BF-01` — BP-009's class; the ACL mapping is applied but never checked for minimality                           | failure families §BF-01                                            |
| `CF-01` — two representations of one thing with nothing comparing them                                          | failure families §CF-01                                            |
| Alpha remains `NO-GO` by the owner's standing decision, independent of any of the above                         | `RFC-0001`                                                         |

### Blocks Beta

| Finding                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- |
| Everything in "Blocks Alpha", plus:                                                                             |
| `humanInterventionRate` and `HumanCorrectionCost` are structurally unmeasured — the harness cannot ask a person |
| Cross-provider and cross-scaffold variance are unmeasured (`6V-2X` not run)                                     |
| Concurrency above C2 is out of scope by §19 and unmeasured                                                      |

### Future Improvement

| Finding                                                                                                                                               | Source                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| The four unenforced link fields, mailbox vocabulary, `traceId` synthesis policy, the `causedBy` gap                                                   | OSS scan §7                                                |
| `testTimeout: 30_000` is deliberately untuned                                                                                                         | gate report, Medium                                        |
| The manifest schema declares no runtime field; node version lives in `notes`                                                                          | [`6V-0-RESULTS.md`](6V-0-RESULTS.md)                       |
| `ScenarioVersion` exists in the harness but is not a manifest-schema field                                                                            | schema review                                              |
| `socialPlurality` is derived in the harness and absent from the runtime's `FieldContext`                                                              | `RFC MISMATCH: FIELD_CONTEXT_SOCIAL_PLURALITY`             |
| `ContextPlanner` receives its five ranking factors as **input** and computes none of them — so no run has measured its judgement, only its sort order | [`RUNNER`](../../evals/src/runner.ts) §`#ledgerCandidates` |

## 2. What §14's twenty-one items need from Phase 6V

The brief says Phase 6V 「只能识别其需求和 blocker」. For each, whether Phase 6V
has produced one:

| §14 item                      | Phase 6V produced                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| npm/package publication       | **Blocker identified** — none of the four packages is publishable: all `private: true`, all depending on `workspace:*`                          |
| executable packaging          | **Blocker** — no bundling or single-binary path exists                                                                                          |
| installers                    | Nothing. No requirement identified either                                                                                                       |
| first-run onboarding          | Nothing                                                                                                                                         |
| graphical UI                  | Nothing. §K forbids UI redesign                                                                                                                 |
| automatic update              | Nothing                                                                                                                                         |
| migration UX                  | **Requirement identified** — `praxis` has no migration path between its own versions; only legacy import from a foreign system                  |
| config UX                     | **Requirement identified** — `OPEN GAP: CONFIGURATION_SURFACE`, registered in `RFC-0001` but not under the `RFC MISMATCH:` spelling             |
| secrets UX                    | **Requirement identified** — 6V-0 established that a provider key is read from the environment and never persisted; no design exists for a user |
| provider setup wizard         | **Requirement identified** — no supported-provider list exists                                                                                  |
| community plugin marketplace  | Nothing                                                                                                                                         |
| stable extension ABI          | **Blocker** — the adapter boundary is `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2`; it is not frozen                                       |
| semantic version policy       | Nothing                                                                                                                                         |
| binary signing                | Nothing                                                                                                                                         |
| distribution mirrors          | Nothing                                                                                                                                         |
| user documentation completion | **Requirement identified** — the docs are engineering-facing throughout; `HANDOFF.md` is the only orientation document                          |
| tutorial                      | Nothing                                                                                                                                         |
| sample projects               | **Requirement identified** — `evals/scenarios/` now holds a scenario format that a sample could use                                             |
| end-user telemetry policy     | Nothing. **And a constraint**: the runtime's observability boundary is provider-neutral by test, so a telemetry design must respect it          |
| production support policy     | Nothing                                                                                                                                         |
| issue triage policy           | Nothing                                                                                                                                         |
| compatibility guarantee       | **Blocker identified** — a supported-platform matrix cannot be declared from what has been measured                                             |
| stable API guarantee          | **Blocker identified** — no package is published, so no API is stable                                                                           |

Fourteen of twenty-one have nothing at all. That is the correct outcome: §14
lists them as Release Engineering's work, and a Phase 6V that had opinions about
all of them would have been doing the next phase's job.

## 3. What §15's fourteen items need

Same treatment, abbreviated — §15 items are auditable checks rather than
designs, so the question is only whether the _evidence_ exists:

| §15 item                        | Evidence from Phase 6V                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release compatibility audit     | Partially — the compatibility surface is now explicit for the first time                                                                                                                  |
| installation validation         | **No.** Nothing installs                                                                                                                                                                  |
| clean-machine installation      | **No.** Never attempted                                                                                                                                                                   |
| documentation validation        | **No**                                                                                                                                                                                    |
| security review                 | **Partial** — `BF-01` and the provider-neutrality suites are a beginning; BP-042 records CI permissions as `allowed_actions=all`                                                          |
| privacy review                  | **Partial, and load-bearing** — the CORPUS-I register establishes that personal material must not enter the public repository, and that its residual identifiability is _not established_ |
| dependency/licence review       | **Partial** — the CORPUS-I material's licence is `UNVERIFIED`; no dependency licence audit exists                                                                                         |
| contribution workflow           | **No**                                                                                                                                                                                    |
| API stability declaration       | **No**                                                                                                                                                                                    |
| supported platform matrix       | **Partial** — measured for Windows and Ubuntu at the pinned runtime; macOS and arm64 `UNKNOWN`                                                                                            |
| known limitations               | **Yes** — this document, plus the failure families and the coverage matrix                                                                                                                |
| migration/update path           | **No**                                                                                                                                                                                    |
| reproducible evaluation package | **Partial** — the harness, the scenario format and the frozen manifest schema now exist                                                                                                   |
| community feedback channel      | **No**                                                                                                                                                                                    |
| release artifact verification   | **No**                                                                                                                                                                                    |

## 4. The one forward-looking risk worth naming here

Phase 6V has added, for the first time, a component whose correctness matters to
the _project's claims_ rather than to its behaviour: the evaluation harness. If
`evals/` is wrong, every Phase 6V conclusion is wrong, and unlike the runtime
there is no product to disagree with it.

The mitigations are real — the oracle path, the throwing validator, the boundary
scan, the empty-denominator control — and they are all _internal_ to the
harness. The counterevidence scan's finding applies exactly: no project found
its own measurement defect by looking at its score.

The external check available is the CORPUS-I `candidate_register`, which is an
independently authored record of 2,050 accept/reject decisions made before
Praxis existed. **Using it to falsify the harness is a higher-value application
of that material than using it to score the runtime**, and it is the only
external verifier this project has.
