# Phase 6 Field Validation Plan

**Status:** proposed — awaiting owner approval and a pilot schedule.
**Precondition:** Phase 6A code complete
([`PHASE-6-GATE.md`](./PHASE-6-GATE.md)).
**Alpha release:** `NO-GO` throughout.

## Why this document exists separately from the gate

Phase 6A verified that the asset and promotion mechanism **does what the Bible
says, under test**. That is a statement about code. It is not a statement about
whether the mechanism is _right_, and the two are easy to confuse because a
green suite feels like evidence of both.

What a test suite cannot tell us:

- whether `minimumIndependentEpisodes: 2` is the right threshold, or whether
  two episodes that look independent to the reviewer are independent in fact;
- whether `exposureInfluenced` gets marked honestly by the person marking it,
  or whether it quietly becomes the field everyone sets to `false`;
- whether a `validated → active` promotion in a live project is followed by
  consequences the policy did not model;
- whether the lifecycle's restore edges are used as intended or as a way to
  route around a challenge.

These are empirical and they need a real field. This plan is how the field is
entered in an order that cannot hurt anyone while it is still being learned.

## 1. How a scenario is selected

The owner has frozen the selection axes and one prohibition. A scenario is
described by the same six dimensions the runtime already models in
`FieldContext` (Bible section 8.1), because a scenario that cannot be described
in those terms is not one this runtime can reason about:

| Dimension              | Values                    | Why it decides placement                               |
| ---------------------- | ------------------------- | ------------------------------------------------------ |
| `consequence`          | low / medium / high       | How much damage a wrong promotion does                 |
| `reversibility`        | easy / partial / hard     | Whether being wrong can be undone                      |
| `feedbackLatency`      | short / medium / long     | How long before we find out we were wrong              |
| `externalVerification` | strong / medium / weak    | Whether reality gets to overrule the system's own view |
| `social plurality`     | single actor / few / many | Whether "independent episode" is even coherent         |
| `taskType`             | free-form label           | What kind of work the field actually is                |

**Prohibition, frozen by the owner:** 日常生活本身不得自动等价为 weak field.
Everyday life is not automatically a weak field. A scenario is placed by its
measured position on the axes above, not by how informal it feels. A casual
chat between two friends can carry high consequence and hard reversibility; a
formal project can be low-consequence and trivially reversible. Deciding by
genre rather than by dimension is how a pilot ends up testing exactly the
scenarios that were safe to describe and not the ones that matter.

## 2. The ladder

Each rung must complete before the next begins. A rung completes when its exit
condition is met **or** when a stop condition fires and the finding is recorded
in [`断点记录.md`](./%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md).

### L1 — low-consequence, reversible, short-feedback

**Profile:** `consequence: low`, `reversibility: easy`, `feedbackLatency:
short`, `externalVerification: strong`, `social plurality: single actor`.

**What it tests:** whether the loop runs at all — event → projection → context
→ residual → reflection → candidate asset → promotion → new event — on work
where being wrong costs nothing and is discovered within the session.

**Candidates:** throwaway scripting tasks, formatting and refactoring chores,
documentation edits, anything with a test suite that answers in seconds.

**Exit condition:** at least one full promotion cycle observed end to end, with
the promotion review retained and the asset's `derivedFrom` chain re-verified
by hand against the ledger.

**Stop condition:** any promotion whose recorded evidence does not resolve, or
any `exposureInfluenced` marking that the operator cannot justify when asked.

### L2 — externally verifiable structured project tasks

**Profile:** `consequence: medium`, `reversibility: partial`,
`feedbackLatency: medium`, `externalVerification: strong`, `social plurality:
single actor or few`.

**What it tests:** whether the mechanism survives contact with a real project
that has its own acceptance criteria — an external verifier that can say no.
This is the first rung where 「强外部验证可以拒绝内部共识」 (INV-09) has
something to reject.

**Candidates:** coursework with a graded rubric, an engineering task with a
test suite the author did not write, a submission with an external deadline and
an external judge.

**Exit condition:** at least one case where the external verifier **disagreed**
with the system's or the operator's assessment, and the disagreement was
recorded as a residual rather than smoothed away.

**Stop condition:** any promotion decided while a known external disagreement
was open.

### Golden Fixture 01

**Profile:** the author's own 《红色源代码：洪湖篇》 Production Card
collaboration chain, sanitised into a minimal event set, with at least one
counterexample — a real task where the user asked to skip the Production Card —
to prevent rule over-fitting.

**Current state:** `WAITING_FOR_AUTHOR_SOURCE`. It is authorial history and
**must not be synthesised**; Bible section 14 states the handling for exactly
this case (「素材不足 → 请求补素材」).

**Why it sits here:** it is the only rung that tests the mechanism against the
author's actual practice rather than against a constructed scenario, and it
requires L1 and L2 to have run so that the instrumentation is known to work
before it is pointed at irreplaceable material. It blocks Alpha exit criterion
11 (「Golden Fixture 01 + 至少一个真实项目连续使用 ≥ 2 周」) and does **not**
block Phase 6B start.

**Exit condition:** fixture replayed through the current code with the golden
derived state reproduced, and the counterexample producing the documented
outcome rather than a promoted rule.

### L3 — knowledge-production, uncertain field

**Profile:** `consequence: medium to high`, `reversibility: partial to hard`,
`feedbackLatency: long`, `externalVerification: weak to medium`, `social
plurality: few`.

**What it tests:** the case the whole project is for — long-horizon work where
reality answers slowly or ambiguously. This is where the Bible's rule that
「weak verification 场景中，默认保留 uncertainty」 is actually load-bearing,
and where a system that quietly upgraded `unknown` into a decision would do
real damage.

**Candidates:** research writing, an ongoing analysis, any project whose
quality is judged months later by people who were not in the room.

**Exit condition:** at least one full 2-week continuous-use window with the
residual record inspected afterwards for anything the operator now disagrees
with, and at least one asset left deliberately unpromoted with the reason
recorded.

### L4 — adversarial, multi-actor field

**Profile:** `consequence: high`, `reversibility: hard`, `feedbackLatency:
long`, `externalVerification: mixed`, `social plurality: many`.

**What it tests:** what happens when more than one person's interests are in
the room, when someone has a reason to mark `exposureInfluenced` as `false`, or
to promote an asset whose evidence is thinner than it looks.

**This rung is not scheduled and should not be, until L1–L3 have produced
evidence.** It is listed because leaving it out would imply the ladder ends
somewhere safe, and because the answers it needs — what "independent" means
across actors, what a challenge is for when the challenger has standing — are
questions the current implementation models structurally (`counterexamples`,
`challenge`, `fork`, plural evidence roots) and has never exercised.

## 3. What invalidates the pilot

Any of these stops the ladder and returns to the gate:

- A promotion whose recorded evidence cannot be re-resolved from the ledger.
- A `validated → active` transition that a non-human writer could have caused.
- An asset whose `derivedFrom` chain, walked by hand, does not support the
  claim in its `body`.
- A residual that was recorded and then silently dropped rather than resolved.
- Any point where the operator cannot say, from the record alone, **who
  decided** and **on what evidence**.

That last one is the real acceptance test for this whole mechanism. If the
record cannot answer it, the asset is not a reusable engineering object; it is
a note with a version number.
