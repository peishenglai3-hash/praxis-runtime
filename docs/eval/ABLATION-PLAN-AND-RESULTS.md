# Ablation Plan and Results

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §2 (`首要方法论：必须有对照组`).
**Implementation:** [`../../evals/src/arms.ts`](../../evals/src/arms.ts),
[`../../evals/src/runner.ts`](../../evals/src/runner.ts).
**Status:** **arms built and self-tested; no ablation has been run.**

## Re-entry update — 2026-09-18

The historical status above remains correct for empirical ablation: no V1/V2/V2X
measurement has run. The evaluator wiring has since been repaired so that the
synthetic `FULL PRAXIS` arm can actually drive candidate creation, validation,
explicit human confirmation, activation, later reuse, ignore, and challenge.
The earlier “`promoteAsset` is never called” and “`contestAsset` is never
called” statements describe the pre-repair tree and must not be read as current
claims. Current mechanism evidence is in `evals/test/assets.test.ts` and
`docs/eval/SCENARIO-BUG-SWEEP.md`; it is harness evidence, not a field result.

---

## 0. The claim this document exists to make falsifiable

§2 refuses a specific inference:

> 不得因为 Praxis + Model → Task Success 就宣称 Praxis 有效。

The core question is stated as: 「相比更简单的系统，Praxis 带来了多少净收益，
以及付出了多少成本？」 — _how much net benefit over a simpler system, and at what
cost_ — and never "did it work".

So this document has one job beyond reporting: to make it impossible for a
future reader to conclude that a successful run is evidence of anything.

## 1. The arms

Six, from §2's A–F. The table is generated from `arms.ts`; the code is the
source of truth and this is a view of it.

| Arm                | §2  | Runtime boundary assembled                            | Adds                                  | Purpose                      |
| ------------------ | --- | ----------------------------------------------------- | ------------------------------------- | ---------------------------- |
| `base`             | A   | _none_                                                | —                                     | the model alone              |
| `state`            | B   | `Phase3Runtime` (ledger + projections + planner only) | ledger, projections, `ContextPlanner` | the price of remembering     |
| `reflection`       | C   | `Phase3Runtime` (+ expectation, residual, reflection) | expectations, residuals, reflection   | noticing, without correcting |
| `full`             | D   | `Phase4Runtime`                                       | candidates                            | the shipped runtime          |
| `full-no-asset`    | E   | `Phase4Runtime`, empty registry                       | —                                     | institution vs accumulation  |
| `full-stale-asset` | F   | `Phase4Runtime`, superseded asset installed           | —                                     | correction vs repetition     |

**The arms are the existing class hierarchy.** `Phase2Runtime` →
`Phase3Runtime` → `Phase4Runtime` was built one phase at a time, each boundary
adding exactly one of the mechanisms §2 names. The ablation ladder is that
structure, not a parallel one, and **no file under `packages/` was modified to
run an arm.** That matters twice: it keeps the work inside the Practice Freeze,
and it makes the comparison fair, because the arms differ by which product code
paths execute rather than by a harness-side reimplementation of them.

`MINIMUM_COMPARISON_ARMS` is `base`, `state`, `reflection`, `full`. A scenario
measured on fewer is `INCOMPLETE`, and `missingArms()` names what is absent —
because the alternative is a table that quietly compares `full` against `base`
and calls it an ablation.

## 2. What would count as a result

Neither "Praxis succeeded" nor "Praxis failed" is a result at this level. The
quantities are:

| Quantity                                                        | Definition                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `IncrementalTaskBenefit`                                        | task-success difference against `base`, **or `not-comparable`**    |
| `FalseResidualRate`                                             | of residuals raised, the share the environment says were not real  |
| `AbstentionAccuracy`                                            | of episodes needing no intervention, the share where none happened |
| `UnnecessaryReflectionRate` / `UnnecessaryContextRetrievalRate` | the over-intervention side                                         |
| cost                                                            | latency, tokens, `HumanCorrectionCost`                             |

An arm that scores _worse_ than `base` is a finding, and §22 names it as a
required outcome: 「知道在哪些场景产生负收益」.

## 3. Results

**No ablation has been run.** There is nothing to report under this heading and
the heading is kept so that its emptiness is visible.

What exists is the apparatus, verified:

| Check                                                                               | Result                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| All four comparison arms run end to end                                             | PASS — `evals/test/oracle.test.ts`         |
| Each arm exercises the mechanism it claims                                          | PASS — asserted as `armErrors: []` per arm |
| `base` reports `falseResidualRate` as **`unscored`**, not `0.000`                   | PASS                                       |
| `reflection` detects a residual exactly on the episodes the environment says failed | PASS — 1 of 4, and not on the other 3      |
| Both manifest sets satisfy the frozen schema                                        | PASS                                       |
| A subject that always throws produces errors, not silent success                    | PASS                                       |

The oracle suite drives all of this with a scripted subject: no model, no
network, no credential. It proves the harness measures what it claims. It
proves **nothing whatever** about the runtime, and every manifest it writes
carries `counterfactual: true` and `scaffold: "oracle"` so that no reader can
mistake it for history.

## 4. What the arms do not yet do

`MECHANISMS_NOT_YET_WIRED` in `arms.ts` is written into the `notes` of every
manifest the harness produces. Reproduced here because a reader of an ablation
table is exactly who needs it:

1. **`promoteAsset` is never called.** Candidates are proposed, never promoted.
   So `promotionPrecision` is unscored, and — the part that matters — an asset
   promoted in episode _N_ cannot affect episode _N+1_. **`assetFeedback` is
   therefore not exercised, and `full` and `reflection` currently differ by
   candidate creation and nothing else.**
2. **`full-no-asset` and `full-stale-asset` assemble the same runtime as
   `full`.** The seeding that distinguishes them is not implemented. Until it
   is, **those two arms must not be reported as run.**
3. **`contestAsset` is never called**, so `challengeRate` is always zero.
4. **The harness never asks a human**, so `humanInterventionRate` is always zero
   and `HumanCorrectionCost` is not measured at all.
5. **Only one scaffold exists.** `scaffold` is recorded in the manifest and
   never varies.

Items 1 and 2 are the ones that block the experiment §4 of the coverage matrix
calls the highest-information one. Item 2 is narrow and mechanical; item 1 needs
a promotion path through `assertAssetValidationReport`, which is a real piece of
work rather than a wiring fix.

**This is stated in the manifest, not only here.** An ablation table read
without this document still carries the warning.

## 5. Cost, which is half the question

§2 asks for net benefit _and_ cost, and the harness records latency and tokens
per episode. Three of the cost metrics are structurally unavailable:

- **`HumanCorrectionCost`** — no design exists for measuring operator time
  inside a scripted run. This caps what any Phase 6V result can claim.
- **Monetary cost** — recorded as `amountReported` where a provider reports it
  and `amountEstimated` where not, and the manifest schema forbids the two being
  merged into one number.
- **`meanLatencyMs`** is recorded but includes harness overhead, and
  `RunManifest.latency.harnessOverheadMs` exists precisely so the two can be
  separated. The harness does not yet populate it.

## 6. What closes the gap

In dependency order:

1. Implement asset promotion in the `full` arm, so `assetFeedback` means
   something. This is the single highest-value engineering item in Phase 6V.
2. Implement the `empty-registry` and `superseded` seeding, so arms E and F
   differ from D.
3. Obtain a credential. Items 1 and 2 need no credential and can be validated
   by extending the oracle suite; the ablation itself cannot.
4. Run `scenario 1` from the coverage matrix §5 — a repeated low-risk task with
   a genuine lesson available early — across all four comparison arms.

Until 4 happens, this document is a plan and the table in §3 stays empty.
