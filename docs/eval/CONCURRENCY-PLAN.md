# Phase 6V Concurrency Plan

**Status:** design — nothing executed. C4 is design-only and must not be run.
**Authority:** owner 6V-PREP brief, 2026-09-17, sections 15–19.
**Phase 6V:** NOT STARTED.

## 0. Why concurrency is in this plan twice

The brief states it directly: concurrency is **both** an engineering property
and an experimental variable. That double role is the reason this document is
separate from the evaluation plan.

As an _engineering property_ it is already partly proved. The repository has a
single-writer lock, a multi-process asset scenario that asserts one revision
winner and three explicit conflicts, and per-agent cursors that explicitly may
sit at different ledger positions. Bible `INV-04` — 「不同 Agent/工具允许处于
不同 seq/cursor，不假设共享同一"现在"」 — is not a hypothesis here; it is a
frozen invariant with tests behind it.

As an _experimental variable_ it is entirely unproved. Nobody has measured
whether the runtime's behaviour under concurrency is _the same_ as under
sequential execution. A system can be correct under concurrency (no lost
updates, no corrupt state) and still behave differently enough that results from
C1 and C0 are not comparable. That is the open question, and it is why the
levels below are **frozen** rather than chosen per experiment.

**The comparison rule that makes the levels meaningful:** every level is
compared against **C0 on the same scenario**, never against another level. A C2
result whose C0 baseline does not exist is not a result.

---

## 1. The frozen levels

| Level  | Name                                 | Isolation                                               | What it establishes                                               | Status             |
| ------ | ------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| **C0** | Sequential baseline                  | One run, one database, one namespace                    | The reference every other level is scored against                 | Design complete    |
| **C1** | Episode parallelism                  | Independent run / database / namespace per episode      | Harness stability, rate limiting, resource contention, throughput | Permitted early    |
| **C2** | Provider / scaffold parallelism      | Same scenario, isolated state, different model/scaffold | Structural comparability of runtime behaviour across subjects     | **High priority**  |
| **C3** | Concurrent readers, isolated writers | Shared history, different cursors, separate mailboxes   | Whether a stale-but-valid cursor is classified correctly          | Preparation only   |
| **C4** | Shared-state concurrent agents       | Multiple roles on one project state                     | Contention, ordering, conflict, recovery                          | **Do not execute** |

**Do not begin with C4.** The brief says so, and the reason is not caution: C4
is the only level where an observed anomaly has no unambiguous cause. At C0–C3
an anomaly points at the runtime; at C4 it points at the runtime, the scenario,
the role assignment, or the schedule, and distinguishing them requires the
baselines that C1–C3 exist to produce.

---

## 2. C0 — sequential baseline

Not a formality. C0 is what makes every other level interpretable, and it has a
specific requirement that is easy to skip: **the manifest must record
`concurrency: "C0"` even though nothing concurrent happened**, because a C2
result that turns out to have been run sequentially is worse than no result.

C0 requirements:

- one manifest per run, `concurrency: "C0"`;
- a fresh database per run, or a recorded `ledgerHeadSeq` if a shared one is
  reused;
- `activeAssetsBefore` recorded, so a promotion is attributable to this run;
- `runtimeCommit` recorded as a full 40-character hash.

**Existing support.** The repository's scenario scripts already run this shape —
`scripts/phase3-residual-reflection.mjs`, `scripts/phase4-assets.mjs` and the
others each build a temporary database under `%TEMP%` and execute one scenario.
None of them writes a manifest, and none is an evaluation harness. They are the
proof that the _pattern_ works, not a harness that can be reused as one.

---

## 3. C1 — episode parallelism

**Recommended initial width: 2–4 runs.** Not because the machine cannot take
more, but because the first purpose of C1 is to find out what breaks, and a
break at width 4 is diagnosable while a break at width 16 is not.

**The isolation rule is absolute:** independent run, independent database,
independent namespace. Two episodes that share a database are not C1; they are
C4 with the label filed off, and the manifest's `concurrency` field would then
be wrong.

What C1 measures, in the brief's own list:

| Measurement            | How it is recorded                                                             | What a bad result looks like                                         |
| ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Harness stability      | Runs that failed for harness reasons / total runs                              | Any harness failure at all; the harness is not yet a harness         |
| Provider rate limiting | `adapterErrorsByKind.rate_limit` per run, and whether it correlated with width | Rate limits appearing at width 2, which means width is not the cause |
| Resource contention    | `latency.wallClockMs` versus the C0 baseline for the same scenario             | Wall clock rising super-linearly with width                          |
| Evaluation throughput  | Completed runs per operator-hour, including setup                              | Throughput that falls when width rises                               |

**A caution that belongs in the plan rather than in a footnote.** The last row
counts _operator_ time, not machine time. If C1 doubles throughput but requires
the operator to reconcile four databases by hand, the honest throughput number
fell. `cost.humanMinutes` exists in the manifest for this reason and C1 is where
it first has a non-zero value to record.

---

## 4. C2 — scaffold portability

**This is the highest-priority concurrency level and the one with an open
gate behind it.** `RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING` in
[`RFC-0001.md`](../RFC/RFC-0001.md) records that Bible section 15's issue-095
acceptance condition —

> 「同一 core fixture 在 Dummy + provider adapter 不改变 core schema/ledger 语义」

— has two sides and only one exists. The dummy side is built. C2 is the
experiment that closes it.

### 4.1 What portability means here, and what it does not

The brief is explicit: 「Do NOT call portability PASS merely because both
providers finish.」 Completion is not portability. The definition this plan
uses:

> **Portability holds when a frozen scenario produces a structurally
> comparable runtime response under two different model/scaffold
> configurations, and every difference between them is explainable by a
> recorded property of the subject rather than by the runtime.**

"Structurally comparable" is deliberately not "identical". Two models will
differ in outcome. The question is whether they differ in _kind_.

### 4.2 The comparison set

For one frozen scenario, run under subject A and subject B, compare:

| Field                            | Comparison                                                       | A difference means                                                   |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `contextPlan.mode`               | equal                                                            | Ranking is responding to the subject rather than to the task         |
| `contextPlan.exposedEventIds`    | set overlap ≥ recorded threshold, and every difference explained | Context selection is subject-dependent in an unexplained way         |
| `counts.residualsByKind`         | same kind set; counts may differ                                 | A capability gap is being read as a behavioural difference           |
| `counts.reflectionsByDecision`   | decision set ⊆ {stop, continue, escalate}; escalations explained | The weaker subject is being escalated to, or the stronger one is not |
| `counts.candidateAssetsProposed` | same order of magnitude, not equal                               | Candidate generation is driven by verbosity, not by evidence         |
| `finalOutcome.status`            | may differ                                                       | Expected. Recorded, not scored.                                      |
| `latency.wallClockMs`            | recorded, never compared for equality                            | Nothing — this is a recorded property                                |
| `cost.*`                         | recorded                                                         | Nothing — recorded property                                          |
| `counts.humanInterventions`      | recorded                                                         | A large gap means the weaker subject is being carried                |

**The one thing that must be equal**, because it is the actual gate condition:
the **core schema and ledger semantics**. Across both subjects, the set of
emitted event types, the projection versions, and the shape of every payload
must be identical. A difference there is not a portability finding; it is a
contract violation and it stops the experiment.

### 4.3 Subjects

| Slot | Subject                                                                                             | Status                          |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| A    | `DummyModelAdapter`                                                                                 | **Exists**                      |
| B    | A real provider adapter                                                                             | **Blocked on `MR-07`**          |
| B'   | A second real provider, or the same provider with a different scaffold (tool loop, prompt template) | Optional; strengthens the claim |

The brief's condition is a Dummy + provider comparison. Adding **B'** is what
distinguishes a _provider_ difference from a _scaffold_ difference, and the run
manifest records `subject.scaffold` separately from `subject.provider` precisely
so this distinction is available. It is recommended, not required.

### 4.4 Exit condition

C2 exits when one frozen scenario has been run at C0 under A and under B, both
manifests are complete, every field in §4.2 has been compared, and each
difference has either an explanation or an open finding. **A C2 with unexplained
differences does not pass; it produces findings.** That is the point of it.

---

## 5. C3 — asynchronous state

C3 is the brief's example made into a runnable scenario:

```
Agent A cursor = 120
Agent B cursor = 115
important update at seq = 118
Agent B proposes an action based on the state at 115
```

**The evaluation must distinguish two claims that look identical from outside:**

| Claim                           | What it is                                   | What it is not                             |
| ------------------------------- | -------------------------------------------- | ------------------------------------------ |
| Agent B **is stale**            | A timing fact. B is behind a relevant event. | Not a judgment about the action B proposed |
| Agent B **is inherently wrong** | A judgment about the action's content        | Not implied by staleness                   |

Bible section 10.1 states the rule: 「Agent 状态落后本身不一定错误；只有在当前任务
相关事件造成不可接受滞后时才形成 TimingResidual」. A stale cursor is a **timing
residual**, and `INV-05` keeps magnitude and effect separate — so the runtime
is required to record _that B was behind_, and is forbidden from recording that
B's action was therefore bad.

**What the runtime already covers, and what C3 adds.** `tests/replay/async-03-stale-agent-cursor.replay.ndjson`
is exactly this scenario at the replay layer, driving
`threshold: { minSeqLag, maxStalenessMs }` against a subscribed agent. It proves
the detector fires. C3 is different in three ways and each is a genuine gap:

1. **The cursor is stale but valid.** The regression test
   `tests/regression/inc-001-regressions.test.ts` "agent cursor integrity"
   covers a cursor pointing past the ledger head and a cursor moving backwards —
   both _impossible_ states. C3's cursor is 115 when the head is 120: entirely
   legal, and the harder case.
2. **B acts.** The replay fixture detects the condition; C3 has B propose an
   action from the stale state and asks what the runtime does with the proposal.
3. **There are two agents with different knowledge.** In the replay fixture the
   stale agent is the only actor. In C3, A is at 120, so a reader must be able to
   tell from the record that B's proposal was made without seq 118 — which is a
   property of the _record_, not of the detector.

**Preparation requirement (not executed in 6V-PREP):** C3 needs a mailbox, since
the scenario's whole point is two agents with separate cursors and separate
message queues. `packages/agents` currently exposes cursor/mailbox-facing ports;
no run has driven them concurrently.

**A tuning dependency worth naming now.** The timing thresholds that decide when
"behind" becomes "unacceptably behind" are **package defaults** —
`OPEN GAP: CONFIGURATION_SURFACE` in [`RFC-0001.md`](../RFC/RFC-0001.md) records
that Bible section 13.2's timing-residual thresholds are not operator
configuration. C3 is the experiment that would produce the evidence to choose
them, and the thresholds cannot be swept from configuration until that gap is
closed. C3 can run against the defaults; it cannot run a **threshold sweep**.
That is a real limitation on what C3 can conclude and it is recorded here rather
than discovered mid-experiment.

---

## 6. C4 — shared state (design only)

**Do not execute until C0–C3 are stable.** Required future tests, from the
brief, with what each would need:

| Test                       | Needs                                                         | Failure it would expose                                      |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Simultaneous proposal      | Two writers, one ledger, deterministic interleaving           | A proposal lost between detection and append                 |
| Conflicting asset proposal | Two agents proposing different bodies for one asset           | Lost update — partially covered by `ASSET_REVISION_CONFLICT` |
| Concurrent verification    | Two verifiers on one expectation                              | Two `verification.completed` events, no arbitration rule     |
| Writer contention          | Many appends under `BEGIN IMMEDIATE` + `busy_timeout`         | `SQLITE_BUSY` surfacing as an application error              |
| Event ordering             | Append order versus `events.seq` order                        | An assumption that arrival order is ledger order             |
| Stale cursor repair        | An agent catching up past events it acted through             | Re-acting on events it has already handled                   |
| Mailbox delay              | A message that arrives after the state it assumed has changed | Acting on a superseded instruction                           |
| Cancellation               | A call cancelled while another actor waits on its result      | A waiter that never resolves                                 |
| Duplicate `operationId`    | Two writers, same operation id                                | The unique index refusing the second — the desired behaviour |
| Failed agent recovery      | An agent that dies mid-operation and restarts                 | Whether its cursor and mailbox reconcile                     |

**Note on the third row.** There is currently **no arbitration rule for two
verification results on one expectation**. The contract permits
`verification.completed` to be appended more than once per expectation and the
`expectations_current` projection resolves to the latest. Whether "latest wins"
is the intended semantics for a _disagreement_ — as opposed to a correction —
has never been decided. The owner's brief names 「verifier disagreement」 as
adversarial fixture `SC-07` and 「不同 verifier result」 as a C4 case. This plan
records it as an **undecided semantic**, not as a bug: nothing has been run that
would have exposed it, and deciding it is an owner decision, not an
implementation choice.

**Evidence, so the claim is checkable.** Read at `4f64c07`:

- `packages/state/src/index.ts:583-594` — the `verification.completed` reducer
  reads the previous expectation only to carry its fields forward, then sets
  `status: outcome` unconditionally. There is no check for an existing
  verification, no conflict branch, and no record that a second result differed
  from the first.
- `packages/store/src/sqlite.ts:3220-3232` — the store's only verification check
  is an **orphan** count: a `verification.completed` whose `expectationId` does
  not resolve. A duplicate or conflicting result is not an anomaly the store
  detects.

So the behaviour is latest-wins in fact and undecided in intent, and the
distinction matters: `SC-07` asks for two verifiers returning different
outcomes, and under the current code the second silently replaces the first with
nothing recorded to say a disagreement occurred.

---

## 7. Anomaly taxonomy for `counts.concurrencyAnomalies`

The manifest carries a count. A count is only useful if the things counted are
defined, so these are the definitions, frozen before any run:

| Anomaly                  | Definition                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `lost-append`            | A draft whose append was authorised and which does not appear in the ledger                  |
| `duplicate-seq-consumer` | Two consumers applying the same seq to one projection                                        |
| `cursor-regression`      | A cursor moving to a lower seq without an explicit rebuild                                   |
| `projection-drift`       | A projection disagreeing with a rebuild from the same ledger at the same version             |
| `cross-namespace-write`  | A writer appending outside its declared namespace                                            |
| `stale-action-applied`   | An action taken from a cursor later than the action's own basis, with the gap recorded       |
| `mailbox-reorder`        | A message delivered out of append order where the scenario required order                    |
| `unresolved-waiter`      | A cancellation that left a second actor waiting                                              |
| `harness-nondeterminism` | A C0 run and its own replay disagreeing, which is a harness defect rather than a runtime one |

`harness-nondeterminism` is last deliberately. Every anomaly above it is a
finding about the runtime; this one is a finding about the harness, and
conflating the two is how a measurement error becomes a bug report.

---

## 8. What invalidates a concurrency result

- Two runs at the same level that share a database but declare `concurrency`
  independently.
- A C1/C2/C3 result with no C0 baseline for the same scenario.
- Any level run at a width that was chosen after seeing the results.
- A `CrossScaffoldVariance` computed from runs whose `subject.scaffold` is not
  recorded, or whose `runtimeCommit` differs.
- A portability claim based on both subjects _completing_.
- Running C4 before C0–C3 are stable.
- Reporting `harness-nondeterminism` as a runtime defect.
