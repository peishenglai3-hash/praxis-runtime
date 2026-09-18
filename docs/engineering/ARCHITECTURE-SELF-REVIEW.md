# Architecture Self-Review

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §13 (`Praxis 架构反证式自查`).
**Status:** first pass. **No refactor is proposed and none is authorised.**

## 0. The rule this document follows

§13 asks one question of each module — 「它真的需要存在吗？」 — and then forbids
the reflex answer:

> 禁止自动重构。

So nothing below is a change proposal. Each module gets one of six verdicts and
the reasons behind it, and the verdict `EVIDENCE-REQUIRED` is the honest answer
far more often than a reviewer usually admits. §13's own list of questions is
the structure: which real problem needs this, is there experimental support, is
there a simpler mechanism, what burden does it add, does it produce false
positives, is it only good for this one author, should it become optional,
should it ship.

**The evidence base is thin and that is stated once here rather than repeated
nine times.** What Phase 6V has produced is (a) 6V-0's nine adapter scenarios on
a development runtime, (b) an oracle self-test that measures the harness, and
(c) the accumulated breakpoint record. **No module below has been measured
doing its job on a real task.** Where a verdict rests on reading code rather
than on a result, it says so.

## Re-entry update — 2026-09-18

The “real task” limitation remains. The evaluator has since gained synthetic
end-to-end asset lifecycle tests, so the pre-reentry statement that the
harness never calls `promoteAsset` is historical rather than current. This
changes readiness evidence, not the architecture verdict: no real-model or
field run has shown that an active asset improves a later task.

---

## 1. Temporal Ledger — `KEEP`

**Which real problem needs it.** Nothing else in the runtime works without it.
It is the substrate: `INV-01` (append-first), `INV-03` (rebuildable
projections), and every downstream mechanism read from it.

**Experimental support.** The strongest of any module, though indirectly. BP-011,
BP-015 and BP-018 are all ledger-fidelity defects — the ledger is the thing
those breakpoints are _about_. It has been exercised on every run in the
project's history and is the only module that has been.

**Simpler mechanism?** No plausible one. The alternative to an append-first
ledger is mutable state, which the Bible rules out and which `INV-01` exists to
prevent.

**Burden.** It is the largest single source of cost in the system: every commit
fsyncs (`synchronous=FULL`), which is why the integration layer needed a 30s
timeout on a cold Windows runner. That cost is real, measured, and accepted.

**False positives?** Not applicable.

**Only good for this author?** No.

**Verdict: `KEEP`.** This is the one module whose existence is not seriously in
question.

## 2. Context Planner — `EVIDENCE-REQUIRED`, with a structural finding

**The finding first, because it is the most substantive thing in this document.**

`ContextPlanner.plan()` receives `ContextSource[]` and ranks them. Look at what
a `ContextSource` carries:

```ts
{
  (id,
    sourceEventId,
    seq,
    text,
    taskRelevance,
    projectRelevance,
    recency, // ← supplied by the caller
    explicitPriority,
    activeRuleRelevance, // ← supplied by the caller
    sourceOrigin);
}
```

**The planner computes none of the five ranking factors.** It is handed them,
multiplies each by a weight from `DEFAULT_RANKING_CONFIG`, sorts, and applies a
token budget. Everything a reader would call "judgement" — is this relevant to
the task, is it recent, does an active rule bear on it — happens _outside_ the
module, in whichever caller assembles the candidates.

I discovered this while building the evaluation harness, because the harness had
to supply those five numbers itself. `evals/src/runner.ts#ledgerCandidates`
now derives `recency` honestly from ledger sequence distance and sets
`taskRelevance` and `projectRelevance` to scenario-scoped booleans, and it says
in its own comment that the strongest claim it can currently evidence is that
much.

**Consequence for measurement.** No run in this project has measured
`ContextPlanner`'s judgement. Every run has measured its _sort order_. The
`ContextHitRate` and `UnnecessaryContextRetrieval` metrics in §18 therefore
score the harness's relevance model and are labelled as the planner's. That is a
measurement defect, not a runtime defect, and it belongs in this review because
it determines what any future result can mean.

**Simpler mechanism?** For what the module actually does — weighted sum, sort,
budget — probably yes. But the module is not where the complexity is, so
simplifying it would not reduce anything.

**Should it become optional?** Not yet. The right question is whether the
_scoring_ should move into the runtime, so that there is one implementation of
it rather than one per caller. That is a real design question and this document
does not answer it.

**Verdict: `EVIDENCE-REQUIRED`.** And the experiment that would supply it is
narrow: run one scenario, have the runtime compute the factors, and compare
against the harness computing them. If nothing changes, the current split is
fine. If results move, the harness has been measuring itself.

## 3. Residual Engine — `KEEP`, with a coverage gap

**Which real problem needs it.** Noticing that an outcome differed from an
expectation, which is the precondition for everything in §3's reflection chain.

**Experimental support.** Real but narrow. The oracle suite exercises the
`outcome` family end to end and asserts the correct episode is the only one
flagged. §6 V1's central measurement — `FalseResidualRate` — is built on this
module, and **it has never been scored against a real model.**

**Coverage gap.** The engine implements three families (`outcome`, `timing`,
`rule`) and only `outcome` has been exercised by the harness. `timing` needs a
subscription and two thresholds; `rule` needs declared event types and
checkpoints. Neither is wired, so `SC-06` (delayed external success) cannot run.

**False positives?** This is the module §6 V1 expects to produce them, and the
`AbstentionAccuracy` metric exists to measure how often. **Zero data.**

**Verdict: `KEEP`**, with the coverage gap recorded. The module is small, pure,
and its interface is the honest one — it returns `Residual | null` per family
and never writes.

## 4. Reflection Controller — `KEEP`, with a design question attached

**Which real problem needs it.** Bounding reflection: `STOP` / `CONTINUE` /
`ESCALATE` with an explicit budget, so that a runtime cannot think forever.

**Experimental support.** `INC-001`'s regressions are the strongest evidence in
the project: the controller stops when the same residual has no new evidence,
stays stopped when driven in a loop, and terminates within budget. Those are
tests of a _harmful_ behaviour not happening, which is rarer and more valuable
than tests of a feature working.

**The design question.** The controller produces proposals that go nowhere. By
design — 「它从不写事件、调用 agent、调用工具、提升资产或改变 residual」 — and
that is right for a bounded-proposal module. But the consequence is that in
the current architecture, **a `CONTINUE` decision has no effect on anything
unless some other layer acts on it**, and there is no such layer in the harness.
The `reflection` arm therefore notices and does nothing, which is exactly what
its own `notA` says. Whether a layer that _acts_ on proposals should exist is
the question `V4` (knowledge production) would answer, and §6 defers it.

**False positives?** `UnnecessaryReflectionRate` is `unscored` on every run so
far, because it needs a live subject.

**Verdict: `KEEP`.**

## 5. ReusableAsset — `EVIDENCE-REQUIRED`, and the weakest evidence in the set

**Which real problem needs it.** The product's central claim: that a lesson from
one episode changes a later one. If this module does nothing, Praxis is a
logging library with a residual detector.

**Experimental support.** **None.** This is the finding. The lifecycle is
implemented (candidate → validated → active → challenged → deprecated), the
promotion policy exists, the Phase 6A tests prove the catalog and the projection
agree — and **no end-to-end run has ever promoted an asset**, because the
harness does not call `promoteAsset`. `MECHANISMS_NOT_YET_WIRED` item 1 records
this in every manifest the harness writes.

So the situation is: the module with the largest claim on being the product's
value has the least evidence of any module here, and `assetFeedback` — the path
where an active asset changes the next episode's context — has never executed.

**Is it only good for this author?** Unanswerable today. `V6` (De-Lai
generalization) is deferred by §6 and `MR-06` is outstanding.

**Simpler mechanism?** There is a genuine alternative worth stating: if the
benefit comes from _recording_ lessons rather than from _promoting_ them, then
the whole validation/promotion lifecycle is overhead and a simpler "notes" model
would do. **Nothing in the evidence distinguishes these.** `full-no-asset` vs
`full` is the experiment that would, and it has not run.

**Verdict: `EVIDENCE-REQUIRED`.** Of everything in this review, this is the
module where an unflattering result is most likely and most valuable.

## 6. Agent Cursor — `DEFER`

**Which real problem needs it.** `INV-04`: actors may occupy different event
cursors, so an agent's view of history is explicit rather than implied.

**Experimental support.** `INC-001`'s regressions cover cursor validation —
past-head refused, backwards refused, forward-only accepted. That is the
_constraint_, not the _mechanism_: nothing has run a real agent from a real
cursor.

**Why `DEFER`.** §19 puts C3 (shared history, isolated proposal writers) and C4
(shared-state concurrent agents) out of this round, and the cursor is the
mechanism those levels need. Its evidence cannot be produced in Phase 6V by
construction. `RFC MISMATCH: AGENT_CURSOR_STORAGE_VS_APPENDIX_B` is separately
open about where cursors are stored.

**Verdict: `DEFER`** — not because it is doubtful, but because the experiment
that would test it is out of scope.

## 7. Adapter Boundary — `KEEP`, the best-evidenced module

**Which real problem needs it.** Keeping provider detail out of the core, so
that neither the error vocabulary nor the trace schema is owned by a vendor.

**Experimental support.** The strongest by a clear margin. 6V-0 drove nine
scenarios through it against a live provider and **nine of nine landed in the
declared taxonomy**, with `timeout` and `cancellation` correctly distinguished.
The provider-neutrality suites separately prove that a provider's exception
class is demoted rather than adopted and that vendor fields cannot enter the
core trace schema.

Two honest limitations, from 6V-0's own document: the binary path
(`unknown_external_failure`) was never reached, and the quota/config gap the OSS
scan flagged is untested rather than closed.

**Burden.** `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` records that the
shipped signature takes `(request, context)` where Bible §10.2 shows one
argument. That is a registered deviation with an owner, not a defect.

**Verdict: `KEEP`.** And the note that it is the only module whose claim has
been tested against something outside the repository.

## 8. FieldContext — `EVIDENCE-REQUIRED`

**Which real problem needs it.** Placing a scenario on axes — consequence,
reversibility, verification strength, feedback latency — so that behaviour can
be conditioned on the field rather than on a single global policy.

**Experimental support.** The five axes are declared, carried through
`Expectation` and `OutcomeDetectionInput`, and used by the residual engine as
context. **Nothing branches on them.** No experiment has shown that varying
`consequence` changes anything the runtime does.

**The known divergence.** `socialPlurality` appears in the evaluation manifest
(`RFC MISMATCH: FIELD_CONTEXT_SOCIAL_PLURALITY`) and not in the runtime's
`FieldContext`. The owner's 2026-09-17 decision keeps it evaluation-derived
until Phase 6 evidence shows the runtime needs it. **This review has produced no
such evidence**, and the harness derives it from `actors.length` where needed.
The decision stands and should not be revisited on the strength of anything
here.

**Simpler mechanism?** The axes may be descriptive rather than operative. If
nothing reads them, they are documentation with a type. That is not
automatically wrong — a declared field can be a contract for later work — but it
should be stated as what it currently is.

**Verdict: `EVIDENCE-REQUIRED`.** The experiment is cheap once a live subject
exists: run one scenario at `consequence: low` and `consequence: high` and see
whether anything differs.

## 9. Evaluation assumptions — `REWORK` (of the harness, not the runtime)

**Which real problem needs it.** §0's fifth question: is the measurement
apparatus itself trustworthy.

**What this review found.** Three defects in the harness during its own
construction, all one shape — a check that passed without looking. Two of them
made an ablation arm behave like a simpler arm while reporting success, which
would have produced a _difference_ in an ablation table that was an artefact of
the harness. Recorded in
[`FAILURE-FAMILIES.md`](FAILURE-FAMILIES.md) §VF-01.

Beyond those, four assumptions in the current harness are load-bearing and
unverified:

1. **Scenario verdicts come from `oracleCommands` or an injected verifier.** For
   `sc-abs-01` the verdict is scripted, which is honest for a self-test and
   means that scenario measures nothing about the runtime.
2. **`taskSucceeded` is `null` when no verifier can adjudicate**, and such
   episodes leave the denominator rather than counting as failures. Correct, and
   it means a scenario with no oracle measures nothing — silently, unless a
   reader checks `unadjudicatedCount`.
3. **The harness supplies the context planner's five ranking factors** (§2), so
   context metrics are partly self-referential.
4. **`humanIntervened` is hard-coded `false`.** `HumanInterventionRate` is
   therefore structurally zero and `HumanCorrectionCost` is not measured at
   all, which caps the cost side of §2's net-benefit question.

Assumption 4 is the one that most limits what any Phase 6V result can say: the
benefit side can be estimated, the cost side cannot.

**Verdict: `REWORK`.** Assumptions 1 and 3 need a live subject; 2 and 4 are
harness design and can be addressed without one.

---

## 10. Summary

| Module                 | Verdict             | Basis                                                                              |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| Temporal Ledger        | `KEEP`              | the substrate; heaviest defect history, heaviest use                               |
| Context Planner        | `EVIDENCE-REQUIRED` | **it computes none of its own ranking factors**; no run has measured its judgement |
| Residual Engine        | `KEEP`              | correct interface, exercised for `outcome` only                                    |
| Reflection Controller  | `KEEP`              | INC-001's harmful-behaviour tests are the project's best evidence                  |
| ReusableAsset          | `EVIDENCE-REQUIRED` | **the module with the biggest claim has no end-to-end evidence at all**            |
| Agent Cursor           | `DEFER`             | the experiment needs C3/C4, which §19 excludes                                     |
| Adapter Boundary       | `KEEP`              | nine of nine against a live provider; the only externally tested claim             |
| FieldContext           | `EVIDENCE-REQUIRED` | five declared axes, nothing branches on any of them                                |
| Evaluation assumptions | `REWORK`            | three self-inflicted defects; four load-bearing unverified assumptions             |

**No `SIMPLIFY`, no `OPTIONALIZE`.** Not because nothing qualifies, but because
each would be a change proposal and §13 forbids automatic refactoring. The two
places a simplification is genuinely plausible — the Context Planner's scoring
split, and whether the Asset promotion lifecycle is doing anything — are both
marked `EVIDENCE-REQUIRED`, which is the gate that has to open before a design
question can be asked honestly.

## 11. What this review did not do

- It did not read every module. `packages/agents` is an empty export, `state`
  and `store` were reviewed only through the defects recorded against them, and
  the legacy-import subsystem was not reviewed at all.
- It did not measure anything. Every verdict is from reading code and from the
  breakpoint record, except §2's finding about the planner's inputs, which came
  from having to call the module.
- It did not propose a change, and §13's prohibition is the reason.
