# Phase 6V Plan — Field and Behavioural Validation

**Status:** proposal — nothing here is authorised or executed.
**Authority:** owner 6V-PREP brief, 2026-09-17, Track C.
**Phase 6V:** NOT STARTED.
**Alpha release:** `NO-GO` throughout.

## 0. What this document is, and what it is not

It is the design of an evaluation harness and an evaluation order, written
before any of it exists, so that the shape can be reviewed while changing it is
still free.

It is **not** a Phase 6V execution plan. Nothing below has been run, no harness
has been built, no runtime file has been modified, and no experiment has been
authorised. The brief's stop condition applies in full: after these preparation
documents, stop and wait for author review.

Three things Phase 6V is not:

- It is not a release gate. Alpha release is `NO-GO` and stays `NO-GO`.
- It is not a correctness re-check. `pnpm verify` is the correctness gate and it
  is green; re-running it under a new name would produce no new information.
- It is not a demonstration. The purpose is to find out where the mechanism is
  **wrong**, and a Phase 6V that reports only confirmations has failed at its
  job — which is the failure INC-001 exists because nobody asked about.

---

## 1. The ladder

Each rung completes before the next begins. A rung completes when its exit
condition is met **or** when a stop condition fires and the finding is recorded
in [`断点记录.md`](../%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md).

### 6V-0 — Adapter reality check

**Purpose.** Prove the Phase 6B contracts against a real provider and a real
tool. No asset learning, no residual evaluation, no reflection.

**Field:** `externalVerification: strong` for the parts reality can check
(timeouts, rate limits, error kinds), `consequence: low`, `reversibility: easy`,
`feedbackLatency: short`.

**Scenarios.** Real model success · timeout · capability mismatch · malformed
response · cancellation · side-effect uncertainty · rate limit.

**Primary question.** Does a real provider's failure land in the taxonomy's
twelve kinds, or does something arrive that none of them describes?

**Exit condition.** Every scenario classified, and every classification checked
against what the provider actually did rather than against what the adapter
reported. A kind chosen because it was the closest fit is a finding.

**Stop condition.** Any error that reaches the runtime as
`unknown_external_failure` **and** could have been classified. The default kind
is correct for genuinely unclassifiable failures; it is a defect when it is
being used as a bin.

**Blocked on `MR-07`.** No provider adapter exists and the owner's Phase 6B
brief forbade writing one.

---

### 6V-1 — Low-consequence, reversible, short feedback

Three sub-rungs. All three ask a version of the same question: **does the
runtime stay quiet when there is nothing to say?**

#### 6V-1A — Low-risk sequential

Formatting, naming, classification, checklist creation, list organisation.
`externalVerification: strong`, `consequence: low`, `reversibility: easy`,
`feedbackLatency: short`, `socialPlurality: single-actor`.

Measures the false-positive side: false residuals, unnecessary reflection,
unnecessary retrieval, unnecessary candidate generation, latency, human
correction cost.

#### 6V-1B — Stale preference and stale history

The same low-consequence work, with a superseded preference or an obsolete
instruction left in history. Adversarial fixture `SC-01`.

This is the first rung where a _correct_ runtime and an _inert_ runtime look
different: an inert runtime ignores the stale preference by accident, and cannot
be distinguished from a correct one until `SC-11` (goal changed mid-task) is
also run.

#### 6V-1C — Interactive low-risk benchmark

A CORPUS-E environment with immediate feedback and full reversibility.
`externalVerification: strong` because the environment itself is the verifier.

**Primary question for the rung.** Is `FalseResidualRate` low enough that the
signal is usable? **No threshold is set here** — see §2.

**Exit condition.** A measured false-residual rate over ≥ 20 episodes, with the
detector's ground truth established by the environment rather than by the
operator.

**Stop condition.** Any episode where an operator's judgement was needed to
decide whether a residual was false. That means the ground truth is not
independent, and every subsequent rate is contaminated.

---

### 6V-2 — Externally verifiable structured work

#### 6V-2A — Code and test verifier

Small engineering tasks with a test suite the author did not write.
`INV-09` — 「强外部验证可以拒绝内部共识」 — has something to reject here.

#### 6V-2B — The real Production Card workflow

The author's own workflow, using whatever survives of `CORPUS-I` I-01. It runs
whether or not Golden Fixture 01 exists; it is weaker without it.

#### 6V-2C — Failure and debug trajectories

CORPUS-E material carrying failure + root cause + evidence + correction +
verifier outcome. This is the closest published analogue to
`Expectation → Observation → Residual → Reflection → Repair`.

**Primary question for the rung.** Can `Expectation → Observation → Residual →
Reflection → Candidate` form correctly under a verifier that can say no?

**Exit condition.** At least one case where the external verifier **disagreed**
with the system's or the operator's assessment and the disagreement was recorded
as a residual rather than smoothed away. This is the existing field validation
plan's L2 exit condition, unchanged.

**Stop condition.** Any promotion decided while a known external disagreement
was open.

**Blocked on `MR-03`** for the author's own unresolved case; `MR-04` for the
revision chain.

---

### 6V-2X — Cross-scaffold / provider comparison

Between 6V-2 and the author review. One frozen scenario, run at C0 under two
different model/scaffold configurations. This is the experiment that closes
`RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING`.

Full method in [`CONCURRENCY-PLAN.md`](./CONCURRENCY-PLAN.md) §4.

**Exit condition.** Both manifests complete, every comparison field evaluated,
every difference explained or recorded as an open finding.

**Stop condition.** Any difference in the emitted event-type set, the projection
versions, or a payload shape between the two subjects. That is a contract
violation, not a portability finding.

---

### Golden Fixture 01 — **unplaced; see §6**

### 6V-3 — Knowledge production, uncertain field

**Requires separate author authorisation.** Not started during 6V-PREP and not
covered by this plan.

`externalVerification: weak to medium`, `consequence: medium to high`,
`reversibility: partial to hard`, `feedbackLatency: long`.

**Primary risk, and the reason it needs its own authorisation:** epistemic
self-reinforcement. The specific failure this rung must detect is a **derived
claim being reused as its own evidence** — a claim written into the ledger,
selected by the context planner, and then cited back as support.

**Special checks:** derived claim reused as evidence; context exposure feedback;
provenance loss; unsupported certainty; failure to abstain.

**Exit condition** (from the existing plan): at least one full two-week
continuous-use window, the residual record inspected afterwards for anything the
operator now disagrees with, and at least one asset left deliberately unpromoted
with the reason recorded.

---

### 6V-4 — Multi-agent, adversarial, asynchronous

**Preparation only.** Requires the concurrency harness at C3 and C4.
`CONCURRENCY-PLAN.md` §5 and §6.

**Cases.** Stale agent · conflicting proposals · different verifier result ·
different actor knowledge state · mailbox lag · shared-state contention ·
institutional rule conflict.

---

### 6V-5 — De-Lai generalisation test

**Conceptual only.** Does Praxis produce value for a user who has not read
The Final and does not share the author's high-reflection interaction style?

Profiles: programmer · humanities or social-science researcher · ordinary
student · creator · low-AI-literacy user.

**Blocked on `MR-06`**, which is a consent question before it is a data
question.

---

## 2. Metrics

Every metric below is stated as a computable definition. **No target value is
given for any of them**, because the brief forbids inventing precision before
data exists and because a threshold chosen before the first measurement is a
wish, not a criterion.

Denominators live in `counts.*` of the run manifest rather than as percentages,
so a later reader can recompute the rate and can tell `1-of-0` from `0-of-0`.

### 2.1 Outcome metrics

| Metric                   | Definition                                                                                    | Ground truth needed   |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------- |
| `TaskSuccess`            | runs whose `finalOutcome.status` is `success` **and** was set by the declared verifier ÷ runs | verifier              |
| `HumanCorrectionCost`    | sum of `cost.humanMinutes` ÷ runs                                                             | operator log          |
| `HumanInterventionCount` | mean `counts.humanInterventions` per run                                                      | ledger + operator log |

### 2.2 Residual metrics

| Metric                    | Definition                                                                       | Ground truth needed       |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| `FalseResidualRate`       | residuals detected where no deviation existed ÷ residuals detected               | independent adjudication  |
| `MissedResidualRate`      | deviations that existed and produced no residual ÷ deviations that existed       | **injection** (see below) |
| `ResidualPrecisionByKind` | the same as `FalseResidualRate`, computed separately for outcome / timing / rule | independent adjudication  |

**`MissedResidualRate` is not measurable on unlabelled history.** A deviation
that left no trace is indistinguishable from no deviation. It is measurable in
exactly two ways, and both are recorded rather than assumed:

1. **Injection** — a known deviation is placed in a `CORPUS-C` fixture and the
   detector either finds it or does not. This measures the detector, not the
   field.
2. **Frozen expectation** — a `CORPUS-P` run whose expectation is registered
   before the work, so "a deviation existed" is a recorded fact rather than a
   retrospective judgement.

Any `MissedResidualRate` quoted from `CORPUS-I` material is invalid and should
be treated as a red flag in a later report.

### 2.3 Reflection metrics

| Metric                      | Definition                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `UnnecessaryReflectionRate` | runs where the correct decision was `stop` and the controller proposed `continue` or `escalate` ÷ runs where a reflection was proposed     |
| `ReflectionEscalationRate`  | `escalate` proposals ÷ reflection proposals                                                                                                |
| `ReflectionTerminationRate` | reflections that terminated within budget ÷ reflections. **Must be 1.0.** Any value below 1 is a runaway, which is an Alpha exit criterion |

`ReflectionEscalationRate` is **descriptive, not scored**. A high rate can mean
the controller is correctly deferring to a human, or that its thresholds are
wrong; the two are told apart by whether the escalations were accepted, which is
a `CORPUS-P` question.

### 2.4 Asset metrics

| Metric               | Definition                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromotionPrecision` | assets promoted that a later review **upholds** ÷ assets promoted                                                                                                                                        |
| `PromotionRecall`    | assets that a later review says **should** have been promoted and were ÷ assets that should have been promoted. Measurable only where the evidence for "should have been" is recorded **before** the run |
| `ChallengeRate`      | assets challenged ÷ assets that reached `active`                                                                                                                                                         |
| `AssetSurvivalRate`  | assets still `active` after N subsequent episodes ÷ assets promoted                                                                                                                                      |

`PromotionRecall` is the metric most likely to be quoted invalidly. It requires
a pre-registered view of which promotions were warranted. Without that it is
retrospective opinion, and this plan records it as measurable **only** under
CORPUS-P with a frozen expectation.

### 2.5 Context and cost metrics

| Metric             | Definition                                                                                                      | Caveat                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ContextTokenCost` | sum of `contextPlan.tokensMeasured` where the provider reported usage, else `tokensEstimated`, **never merged** | The two are reported separately; a merged number is not a measurement    |
| `ContextHitRate`   | exposed items that the subsequent action actually referenced ÷ items exposed                                    | Requires the reference to be observable; a model's silence is not a miss |
| `LatencyOverhead`  | `(harnessOverheadMs + reflectionMs) ÷ subjectMs`                                                                | Meaningless at `subjectMs` ≈ 0; report the raw values then               |

The Bible's Alpha target for context is 「先测量，不预设」 — measure first, do not
presuppose. These two metrics are that measurement and no target is attached.

### 2.6 Variance and determinism metrics

| Metric                    | Definition                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CrossScaffoldVariance`   | a **structured comparison**, not a scalar. For a frozen scenario run under two subjects: the per-field difference table in `CONCURRENCY-PLAN.md` §4.2, plus a count of unexplained differences |
| `CrossProviderVariance`   | the same computation where the two subjects differ in provider rather than in scaffold                                                                                                         |
| `ReplayDeterminism`       | replays producing byte-identical projection state at the same version ÷ replays attempted. **Must be 1.0**; below 1 is a defect, not a finding                                                 |
| `ConcurrencyAnomalyCount` | count over the frozen anomaly taxonomy in `CONCURRENCY-PLAN.md` §7                                                                                                                             |

Deliberately **not** reduced to a single "portability score". A score would
average an unexplained context difference with an expected latency difference
and produce a number that means nothing. The brief's instruction is that runtime
behaviour must remain _structurally comparable_; a scalar cannot express that.

### 2.7 Abstention metrics

| Metric               | Definition                                                                                          | Applicability                        |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `AbstentionAccuracy` | cases where the runtime correctly declined to decide ÷ cases where declining was the correct answer | **weak-verification scenarios only** |

This is the metric that matters most for the Bible's rule that 「weak
verification 场景中，默认保留 uncertainty」, and it is the metric that benchmarks
structurally cannot supply — benchmarks score acting, so a correct abstention
looks like a failure. It is measurable in `CORPUS-P` and in human-annotated
`CORPUS-I`, and nowhere else.

---

## 3. Annotation protocol for qualitative metrics

`FalseResidualRate`, `UnnecessaryReflectionRate`, `PromotionPrecision`,
`PromotionRecall` and `AbstentionAccuracy` all require someone to decide whether
something _should_ have happened. That decision is a judgement, and the protocol
below exists so the judgement is auditable rather than implicit.

**Protocol.**

1. **The adjudicator is not the operator.** The person judging whether a
   residual was false is not the person who ran the scenario. If the project has
   only one person available, this is recorded as a limitation on every rate
   derived from it rather than dropped.
2. **Adjudicate blind.** The adjudicator sees the expectation, the observation
   and the residual, and does **not** see whether the detector fired until after
   the judgement is recorded. Showing the answer first converts measurement into
   confirmation.
3. **Record the reason, not only the verdict.** Every adjudication carries a
   one-line justification that cites the evidence. A verdict without a reason
   cannot be revisited and is therefore not evidence.
4. **Record disagreement between adjudicators.** If two adjudications exist,
   both are kept. The disagreement rate is itself a measurement of how
   well-defined the criterion is.
5. **Adjudicate before viewing outcomes.** Where a run's `finalOutcome` would
   bias the judgement, the adjudication is recorded with its timestamp and the
   outcome is not opened until it is.
6. **Never re-adjudicate after seeing a rate.** A second pass is permitted only
   if the first is retained and the reason for the second is recorded. A rate
   that moved because the criterion moved is not a measurement.

**Mixed-initiative cases.** Where the correct answer is genuinely ambiguous, the
adjudication is recorded as `ambiguous` and **excluded from both numerator and
denominator**, with the exclusion count reported. Excluding silently, or
counting ambiguous cases as correct, are both ways to make a rate meaningless.

---

## 4. Verifier design

The verifier is what lets a claim about the runtime be checked by someone who
does not trust the report. Per rung:

| Rung  | Verifier                                                                            | Independence                                             |
| ----- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 6V-0  | The provider's own behaviour — the status code, the body, whether the effect landed | **High.** Reality, not a model                           |
| 6V-1  | The environment's own success condition                                             | **High**                                                 |
| 6V-2A | A test suite the author did not write                                               | **High**                                                 |
| 6V-2B | The workflow's own acceptance step — the author's approval                          | **Medium.** The author is a participant                  |
| 6V-2C | The dataset's recorded verifier outcome                                             | **High** for the corpus; **low** for this author's field |
| 6V-3  | Human judgement at long horizon                                                     | **Low.** This is why 6V-3 needs its own authorisation    |
| 6V-4  | Protocol-defined outcome per anomaly                                                | **High**                                                 |
| 6V-5  | Participant-reported value                                                          | **Low** and self-selected                                |

**The rule the manifest enforces:** `verifier.independent` is `true` only when
the verifier was authored by someone other than the author of the artefact it
judges. A run whose only verifier is the subject is weak-field by construction
and must be placed as such in `field.externalVerification` — not reported as a
strong-verification result because the _scenario_ looked formal.

---

## 5. Reproducibility

Requirements, recorded in `reproducibility` of the manifest:

1. **`runtimeCommit` is a full 40-character hash**, and `runtimeDirty` is
   recorded. A run against a dirty tree is kept and labelled, not discarded.
2. **A `CORPUS-P` run is replayable from its recorded transcript where the
   subject permits it.** Non-replayable runs are permitted and must name their
   non-determinism sources.
3. **Named non-determinism.** Sampling, provider-side model changes, and
   wall-clock-dependent behaviour are named in `reproducibility.nondeterminism`.
   Naming them is what makes a cross-scaffold comparison interpretable: a
   difference between two subjects that is inside the named variation is not a
   portability finding.
4. **Replay and live are never merged.** `subject.counterfactual` is `true` for
   anything driven from a recording. Bible section 15's EPIC-010 risk row says a
   replay missing model/scaffold metadata 「会被误解为真实历史重演」; the flag is
   what prevents it.
5. **The ledger stays the ledger.** An evaluation run writes its own events
   through the existing `EventWriter` with the existing writer contexts. No
   evaluation-only event namespace is created, because a parallel record of what
   happened is exactly the second source of truth the runtime exists to avoid.

---

## 6. The unplaced rung — Golden Fixture 01

**This is the one structural problem this preparation found in the owner's
brief, and it is raised rather than fixed.**

Two ladders now exist:

- [`PHASE-6-FIELD-VALIDATION-PLAN.md`](../PHASE-6-FIELD-VALIDATION-PLAN.md),
  written at the end of Phase 6A, ordered
  `L1 → L2 → Golden Fixture 01 → L3 → L4`.
- The 6V-PREP brief's section 26 order:
  `6V-0 → 6V-1A/1B/1C → 6V-2A/2B/2C → 6V-2X → 6V-3 → 6V-4 → 6V-5`.

The two are compatible in substance — 6V-1 refines L1, 6V-2 refines L2, 6V-3 is
L3, 6V-4 is L4, and 6V-0 and 6V-5 are genuinely new. **But Golden Fixture 01 does
not appear anywhere in the brief's order.**

That is not a cosmetic omission. The existing plan places it deliberately:

> it requires L1 and L2 to have run so that the instrumentation is known to work
> before it is pointed at irreplaceable material.

If the brief's order is followed literally, the fixture is either dropped, or
run at a point where the instrumentation is unproven, or slotted somewhere
arbitrary — and all three are worse than the deliberate placement.

**Recommendation:** take the brief's order as the refinement of the existing
ladder, and place Golden Fixture 01 **between 6V-2X and 6V-3**, which is where
the existing plan's rationale puts it once 6V-1 and 6V-2 have run.

**Why this is raised instead of applied.** The owner froze the order in
section 26, and `INV-10` forbids silently compensating a structural mismatch —
including one introduced by the owner's own brief. Recorded for the owner to
decide, with both readings available.

Also carried: the existing plan's §3 "What invalidates the pilot" applies to
Phase 6V unchanged. It is not restated here.

---

## 7. Code gap scan

Against the owner's section 21 checklist. Method: a search of **every tracked
file** for each term, excluding `packages/*/dist/`. Absence is reported as
"the search returned nothing", never as "it does not exist" — a search can prove
presence and cannot prove absence, which is `BP-058`'s lesson.

| #   | Capability                       | Finding                                                                                                                                                                                                                  | Classification       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 1   | Run manifest                     | **ABSENT.** `RunManifest`, `runId` as an evaluation id, `corpusType`, `concurrencyMode`: no implementation. The schema is proposed in this phase.                                                                        | **BLOCKS 6V-0**      |
| 2   | Evaluation adapter               | **ABSENT.** `EvaluationAdapter`, `Evaluator`, `evaluator`: nothing.                                                                                                                                                      | **BLOCKS 6V-1**      |
| 3   | Metrics aggregation              | **ABSENT.** `metric`/`Metrics`: nothing anywhere in the tree.                                                                                                                                                            | **BLOCKS 6V-1**      |
| 4   | Cost tracking                    | **ABSENT.** The only `estimatedCost` is a reflection hypothesis estimate (`packages/reflection/src/index.ts:46`), not provider cost.                                                                                     | **BLOCKS 6V-1**      |
| 5   | Latency tracking                 | **ABSENT.** Every `latency` in the tree is `feedbackLatency` — a _declared property of the field_, not a _measured duration_ — or the `openaiLatency` anti-example comment.                                              | **BLOCKS 6V-1**      |
| 6   | Scenario registry                | **ABSENT.** `scenario` matches are test-helper names (`ScenarioName`, `replayedScenario`) and the `scripts/phase*.mjs` gates. No registry, no discovery, no scenario ids.                                                | **BLOCKS 6V-1**      |
| 7   | Provider / scaffold identity     | **PARTIAL.** `ModelRunMetadata` carries `provider`, `model`, `scaffold` as contract fields — but **nothing persists them**. The gate records this as gap 1.                                                              | **BLOCKS 6V-0**      |
| 8   | Model version capture            | **PARTIAL.** `model` is a single string with no separate version field; `MR-07` and the manifest both need one.                                                                                                          | **BLOCKS 6V-2X**     |
| 9   | Verifier abstraction             | **PARTIAL, different axis.** `VerificationPolicy` / `VerificationResult` exist and are solid — but they verify _an expectation inside the runtime_, not _a Phase 6V run_. No evaluation verifier exists.                 | **BLOCKS 6V-2**      |
| 10  | Run isolation                    | **PARTIAL.** Scenario scripts build a temp database with `mkdtempSync`; there is no isolation _contract_ and no per-episode namespace.                                                                                   | **BLOCKS 6V-1** (C1) |
| 11  | Concurrency isolation            | **PARTIAL.** `WriterOwnershipLock` and the multi-process scenario scripts exist and are tested; C1's independent-namespace rule is not implemented.                                                                      | **BLOCKS 6V-1** (C1) |
| 12  | Seed / reproducibility           | **ABSENT as written.** Every `seed` in the tree is a test-setup helper (`seedEvent`, `seedReviewEvents`, `seedCandidateAsset`). No reproducibility seed.                                                                 | **BLOCKS 6V-1**      |
| 13  | Result persistence               | **ABSENT for evaluation.** The ledger persists run events; nothing persists an evaluation result or a manifest.                                                                                                          | **BLOCKS 6V-1**      |
| 14  | Human annotation support         | **ABSENT.** The single `annotation` match is a reflection message string about _retrospective annotation_, not a review tool.                                                                                            | **BLOCKS 6V-2**      |
| 15  | Benchmark import boundary        | **ABSENT.** `benchmark`: nothing.                                                                                                                                                                                        | **BLOCKS 6V-2**      |
| 16  | Dataset provenance metadata      | **ABSENT.** `dataset`, `provenanceQuality`, `corpusType`: nothing.                                                                                                                                                       | **BLOCKS 6V-2**      |
| 17  | Licence metadata                 | **ABSENT.** `license` matches are the repository's own `LICENSE` and package metadata. No per-dataset licence record.                                                                                                    | **BLOCKS 6V-2**      |
| 18  | Trace linking                    | **PARTIAL, and the strongest existing piece.** `traceId` appears in 41 files and is propagated through events, the ledger schema and `AdapterExecutionContext`. What is missing is only the evaluation-side correlation. | **Not blocking**     |
| 19  | Provider adapter                 | **ABSENT.** Deliberate, per the Phase 6B gate.                                                                                                                                                                           | **BLOCKS 6V-0**      |
| 20  | Mailbox / multi-agent runtime    | **PARTIAL.** `packages/agents` exposes cursor and mailbox-facing ports; no concurrent run has driven them.                                                                                                               | **BLOCKS 6V-4**      |
| 21  | Shared-state concurrency harness | **ABSENT.**                                                                                                                                                                                                              | **BLOCKS 6V-4**      |
| 22  | Knowledge-production checks      | **ABSENT.** The specific checks for derived-claim-reuse-as-evidence have no implementation.                                                                                                                              | **BLOCKS 6V-3**      |
| 23  | Participant consent handling     | **ABSENT**, and it is a governance artefact before it is code.                                                                                                                                                           | **FUTURE** (6V-5)    |
| 24  | Cross-OS evaluation CI           | **ABSENT.** `pnpm verify` runs on Ubuntu and Windows; no evaluation workflow exists.                                                                                                                                     | **FUTURE**           |

**Nothing above is to be implemented in this phase.** The brief states it
directly: 「Do not implement automatically.」

**The pattern worth naming.** Items 1–6 are all **evaluation plumbing**, and
they are absent together. That is not neglect — the project has never run an
evaluation, so it has nothing to plumb. The consequence is that 6V-1 cannot
start with a scenario; it must start with a harness, and the harness is larger
than any single rung. That is the honest cost of Phase 6V and it belongs in the
plan rather than being discovered at the first run.

**One positive note that is not a compliment.** Item 18 (`traceId`) is already
propagated correctly across the ledger and the adapter boundary, and item 9's
verification contracts are strong. The evaluation harness can therefore _join
to_ the existing record rather than maintain a parallel one — which is the only
way the manifest can be checked against the ledger at all.

---

## 8. Execution order

```
6V-0   Adapter reality check            [BLOCKED: MR-07]
  ↓    gate: every provider failure classified against observed behaviour
6V-1A  Low-risk sequential
6V-1B  Stale preference / history
6V-1C  Interactive low-risk benchmark
  ↓    gate: an independent ground truth exists, and the detector's false-positive rate is measured
6V-2A  Code / test verifier
6V-2B  Real Production Card workflow    [WEAKER WITHOUT: MR-01]
6V-2C  Failure / debug trajectory       [BLOCKED: MR-03]
  ↓    gate: ≥1 recorded external disagreement, kept as a residual
6V-2X  Cross-scaffold / provider comparison   → closes SCAFFOLD_PORTABILITY_PENDING
  ↓    AUTHOR REVIEW
Golden Fixture 01                        [BLOCKED: MR-01, MR-02]  ← see §6, unplaced in the brief
  ↓    AUTHOR REVIEW
6V-3   Knowledge-production pilot        [SEPARATE AUTHORISATION REQUIRED]
  ↓    AUTHOR REVIEW
6V-4   Multi-agent / adversarial         [needs C3–C4 harness]
  ↓    AUTHOR REVIEW
6V-5   De-Lai generalisation             [BLOCKED: MR-06]
```

**Harness could be built in parallel with 6V-0**, since the adapter work and the
plumbing share no state. That is a scheduling note, not a reordering.

---

## 9. Recommendation

| Rung | Ready?                                                                                      |
| ---- | ------------------------------------------------------------------------------------------- |
| 6V-0 | **NO** — needs `MR-07` and items 1, 7, 19 of §7                                             |
| 6V-1 | **CONDITIONAL** — needs items 2, 3, 4, 5, 6, 10, 11, 12, 13; and `MR-05` for real scenarios |
| 6V-2 | **CONDITIONAL** — needs items 9, 14, 15, 16, 17; and `MR-03`                                |
| 6V-3 | **NO** — not authorised, and items 22 is absent                                             |
| 6V-4 | **NO** — design only, items 20–21 absent                                                    |
| 6V-5 | **NO** — `MR-06` is a consent question                                                      |

**Nothing in this plan is authorised by this plan.** The brief's stop condition
applies: stop and wait for author review.
