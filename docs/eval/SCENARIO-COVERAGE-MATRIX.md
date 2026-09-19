# Scenario Coverage Matrix

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §7 (`Scenario Coverage Matrix`).
**Companion:** [`COMPATIBILITY-SURFACE-MAP.md`](COMPATIBILITY-SURFACE-MAP.md) — the
same exercise applied to environments rather than scenarios.

## 0. The rule this document is written under

§7 states the prohibition before it states the goal:

> 禁止：「没有测到」→ 自动推断为支持。

So every cell carries one of exactly five statuses, and **there is no sixth
meaning "probably fine"**:

| Status             | Means                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `TESTED`           | An experiment ran, and its manifest exists                                                                          |
| `PARTIALLY TESTED` | Something ran in this region, but not the thing the cell names                                                      |
| `NOT TESTED`       | Nothing ran here                                                                                                    |
| `UNSUPPORTED`      | The implementation cannot reach here, and that is a decision                                                        |
| `UNKNOWN`          | Not established either way — weaker than `NOT TESTED`, because it means we do not even know whether the path exists |

`NOT TESTED` is not a defect. A blank cell read as a pass is.

**Most of this matrix is `NOT TESTED`.** That is the honest state of Phase 6V at
this point and the document would be worthless if it were not. §22 requires
knowing where the runtime is effective, where it is not, where it is harmful, and
**where nothing is yet known** — this file is that last column, made explicit.

## 1. What has actually been run

Everything in this section has a manifest. Everything not in this section has
none.

| Run                             | Ladder | Corpus                       | Subject       | Provider/model          | Runtimes                               | Manifest                                     |
| ------------------------------- | ------ | ---------------------------- | ------------- | ----------------------- | -------------------------------------- | -------------------------------------------- |
| 6V-0, nine adapter scenarios    | 6V-0   | `corpus-p` ×5, `corpus-c` ×4 | live provider | one provider, one model | Node **24.15.0**, `runtimeDirty: true` | `test-results/6v0/*.json`                    |
| Oracle self-test, four arms     | —      | `corpus-c`                   | scripted      | none                    | Node 24.15.0                           | written per run, discarded with the temp dir |
| `sc-abs-01` low-risk abstention | 6V-1   | `corpus-c`                   | scripted      | none                    | Node 24.15.0                           | as above                                     |

That is the complete list of empirical runs in this project. Two of the three
used a **scripted** subject and therefore measure the harness, not the runtime;
the third is development-runtime evidence that its own results document refuses
to promote.

### Re-entry update — 2026-09-18

The table entries below were written before the Round 1 asset wiring. They are
retained as a dated audit snapshot, but the current evaluator facts are:

- `FULL PRAXIS` now has a tested candidate → validation → explicit human
  confirmation → active → later reuse/ignore/challenge path;
- `REFLECTION` and `FULL PRAXIS` are behaviorally distinct in the harness;
- the ten-episode synthetic manifest is loadable;
- this still is **not** a V1/V2/V2X field result, and no real historical corpus
  has been ingested.

Use [`SCENARIO-BUG-SWEEP.md`](SCENARIO-BUG-SWEEP.md) and
[`EMPIRICAL-READINESS.md`](EMPIRICAL-READINESS.md) for the current Round 1
status. They do not upgrade any field or provider cell below without a real
manifest.

**No run has yet used a real model to do a real task with Praxis state behind
it.** That sentence is the honest summary of Phase 6V's empirical state, and
every cell below should be read in its light.

## 2. The matrix

Dimensions are §7's. A scenario name in a cell is a scenario that has been run;
`—` is `NOT TESTED`. Where a whole row is `NOT TESTED` the reason is given once,
in §3, rather than repeated fourteen times.

### 2.1 Field axes

| Dimension                 | Value     | Status             | Note                                                                                                                         |
| ------------------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Task complexity**       | low       | `PARTIALLY TESTED` | Only `sc-abs-01`, and only with a scripted subject                                                                           |
|                           | medium    | `NOT TESTED`       |                                                                                                                              |
|                           | high      | `NOT TESTED`       |                                                                                                                              |
| **Consequence**           | low       | `PARTIALLY TESTED` | All three runs were placed low                                                                                               |
|                           | medium    | `NOT TESTED`       |                                                                                                                              |
|                           | high      | `UNSUPPORTED`      | No scenario may be placed here while GF01 is unavailable — §16 forbids synthesising the material such a run would need       |
| **Reversibility**         | easy      | `PARTIALLY TESTED` |                                                                                                                              |
|                           | moderate  | `NOT TESTED`       | The runtime's `FieldContext` uses `partial`; the brief uses `moderate`. A naming difference, recorded rather than reconciled |
|                           | hard      | `NOT TESTED`       |                                                                                                                              |
| **Feedback latency**      | immediate | `NOT TESTED`       |                                                                                                                              |
|                           | short     | `PARTIALLY TESTED` |                                                                                                                              |
|                           | long      | `NOT TESTED`       |                                                                                                                              |
| **External verification** | strong    | `PARTIALLY TESTED` | 6V-0's HTTP status codes are a strong verifier of a narrow claim                                                             |
|                           | medium    | `NOT TESTED`       |                                                                                                                              |
|                           | weak      | `NOT TESTED`       |                                                                                                                              |

### 2.2 History

| Dimension           | Value         | Status             | Note                                                                                                                     |
| ------------------- | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **History length**  | none          | `TESTED`           | Every run so far starts from an empty ledger                                                                             |
|                     | short         | `PARTIALLY TESTED` | `sc-abs-01` accumulates four episodes within one run                                                                     |
|                     | long          | `NOT TESTED`       | The [CORPUS-I register](CORPUS-I-REGISTER.md) describes 11,411 real records over four months; **none has been ingested** |
| **History quality** | clean         | `PARTIALLY TESTED` |                                                                                                                          |
|                     | stale         | `NOT TESTED`       | `SC-01`, `SC-12` are designed and unrun                                                                                  |
|                     | contradictory | `NOT TESTED`       | `SC-02`                                                                                                                  |
|                     | incomplete    | `NOT TESTED`       |                                                                                                                          |

### 2.3 Assets and reflection

| Dimension           | Value      | Status             | Note                                                                                                |
| ------------------- | ---------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| **Asset state**     | none       | `PARTIALLY TESTED` | The state every run starts in                                                                       |
|                     | valid      | `NOT TESTED`       | No arm has ever promoted an asset — see `MECHANISMS_NOT_YET_WIRED`                                  |
|                     | stale      | `NOT TESTED`       | `SC-12`; the `full-stale-asset` arm exists but assembles the same runtime as `full`                 |
|                     | wrong      | `NOT TESTED`       | `SC-05`                                                                                             |
|                     | challenged | `NOT TESTED`       | `SC-02`, `SC-07`; no arm calls `contestAsset`                                                       |
| **Reflection need** | none       | `PARTIALLY TESTED` | `sc-abs-01` episodes 1–3 are exactly this, and it is the one region with a real assertion behind it |
|                     | useful     | `NOT TESTED`       |                                                                                                     |
|                     | essential  | `NOT TESTED`       |                                                                                                     |
|                     | harmful    | `NOT TESTED`       | §13's question — where reflection makes things worse — has no data at all                           |

### 2.4 Subject and environment

| Dimension              | Value                         | Status             | Note                                                                                                                                                                                      |
| ---------------------- | ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider**           | one provider, one model       | `PARTIALLY TESTED` | 6V-0; `corpus-p` for five scenarios, `corpus-c` for four                                                                                                                                  |
|                        | a second provider             | `NOT TESTED`       |                                                                                                                                                                                           |
|                        | a second model, same provider | `NOT TESTED`       | 6V-2X's minimum                                                                                                                                                                           |
| **Scaffold**           | `oracle` (scripted)           | `TESTED`           | But it measures the harness, not the runtime                                                                                                                                              |
|                        | variant A (live)              | `PARTIALLY TESTED` | 6V-0 only; no task execution                                                                                                                                                              |
|                        | variant B                     | `NOT TESTED`       | 6V-2X requires it                                                                                                                                                                         |
| **Environment**        | Windows + Node 24.15.0        | `TESTED`           | Every run so far                                                                                                                                                                          |
|                        | Ubuntu + Node 22.13.0         | `NOT TESTED`       | **for experiments** — CI passes here, but no 6V run has                                                                                                                                   |
|                        | Windows + Node 22.13.0        | `NOT TESTED`       | The pinned production runtime                                                                                                                                                             |
|                        | macOS / arm64                 | `UNKNOWN`          |                                                                                                                                                                                           |
| **Concurrency**        | C0                            | `TESTED`           | Every run                                                                                                                                                                                 |
|                        | C1                            | `NOT TESTED`       |                                                                                                                                                                                           |
|                        | C2                            | `NOT TESTED`       |                                                                                                                                                                                           |
|                        | C3 / C4                       | `UNSUPPORTED`      | Out of scope by §19                                                                                                                                                                       |
| **Human intervention** | none                          | `TESTED`           | The harness never asks, so every run is this by construction — which is itself the finding: `humanInterventionRate` is structurally zero and `HumanCorrectionCost` is not measured at all |
|                        | low                           | `NOT TESTED`       |                                                                                                                                                                                           |
|                        | high                          | `NOT TESTED`       |                                                                                                                                                                                           |

### 2.5 The synthetic adversarial set

`CORPUS-MANIFEST.md` §4 defines thirteen scenarios. None has been run.

|        | SC-01 | SC-02 | SC-03 | SC-04 | SC-05 | SC-06 | SC-07 | SC-08 | SC-09 | SC-10 | SC-11 | SC-12 | SC-13 |
| ------ | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Status | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    | NT    |

All thirteen are `NOT TESTED`. They are grouped rather than tabulated because
the column of `NOT TESTED` is the information, and spreading it over thirteen
rows would imply a granularity that does not exist.

## 3. Why so much is untested, stated once

Three causes, in order of how much they explain:

1. **No live credential was available in this session.** V0-live, V1, V2, V2X
   and the ablation all need a real model. The owner has undertaken to supply a
   key; until it exists, no experiment requiring one can run, and the
   alternative — a scripted subject — measures the harness rather than the
   runtime. That substitution is legitimate and it is what the oracle suite
   does; it is not a substitute for field evidence and must never be reported as
   one.

2. **The harness was built in this phase and is one day old.** It runs a
   scenario across four arms end to end, which it did not do before today. The
   matrix is largely empty because the instrument now exists and has not been
   pointed at anything yet.

3. **Some regions are blocked on author material, not on tooling.** Golden
   Fixture 01 needs `MR-01`/`MR-02`. V1 proper needs `MR-05`. V2's
   human-production verifier needs the 洪湖篇 workflow subset. None of these is
   a research question and none can be worked around.

## 4. The high-risk quadrants

§7 asks for these explicitly. A quadrant is high-risk when **being wrong there
is expensive and being right is unverified**, and the ranking below uses that
test rather than likelihood.

### Q1 — `asset state: valid | reflection need: essential | history: long`

**The runtime's entire claim lives here and it is empty.** Praxis exists to
carry a lesson from one episode into a later one. Every cell this depends on —
long history, a valid asset, essential reflection — is `NOT TESTED`, and the
harness does not yet promote an asset at all (`MECHANISMS_NOT_YET_WIRED`
item 1). A Phase 6V that ends without entering this quadrant has not tested the
product; it has tested the plumbing.

### Q2 — `reflection need: harmful`

**Both failure directions at once, and no data.** §13 asks "是否产生 False
Positive?" and "是否只对原作者有效?" — the questions where Praxis could be
_worse_ than BASE. `sc-abs-01` tests abstention on episodes needing nothing, but
no scenario tests an episode where reflecting actively damages the outcome.
Until one runs, "Praxis helps" and "Praxis sometimes hurts" are equally
supported by the evidence, which is to say both are unsupported.

### Q3 — `history quality: stale | asset state: stale`

**Staleness is the mechanism most likely to be quietly wrong**, because the
failure is silent: the runtime confidently applies a superseded rule and the
task may still succeed. `SC-01` and `SC-12` are designed for this and unrun, and
the `full-stale-asset` arm that would run them does not yet differ from `full`.
This quadrant is where a false PASS would be most costly and most invisible.

### Q4 — `environment: Windows | Node 22.13.0` (for experiments)

**The production runtime has never run an experiment.** CI passes on it, so the
_engineering_ is verified there. No 6V run has ever executed on it, and BP-061
and BP-063 are both what it looks like when that gap closes badly. Every result
currently in `test-results/` is transferable to the pinned runtime only by
assumption, and §A3 of the finalization brief forbids exactly that assumption.

### Q5 — `human intervention: low | high`

**The harness cannot ask a person, so the metric is structurally zero.**
`HumanCorrectionCost` — the cost side of §2's net-benefit question — is not
measured at all, and no design exists for measuring it inside a scripted run.
This is not a scenario gap but a harness gap, and it caps what any result from
this phase can claim: the benefit side can be estimated, the cost side cannot.

## 5. Representative scenarios chosen from the above

§7 asks which high-information scenarios to run. Four, in order, each chosen
because it discriminates between hypotheses rather than because it is easy:

| #   | Scenario                                                                                               | Discriminates                                                                                  | Needs                                              |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | A **repeated low-risk task** with a genuine lesson available from episode 1 that pays off by episode 4 | `full` vs `full-no-asset` — the only comparison that shows institutionalisation doing anything | credential; the harness's promotion path           |
| 2   | **`SC-01` outdated preference** at low consequence                                                     | `state` vs `reflection` — whether noticing without correcting is enough                        | harness only                                       |
| 3   | A **deterministic coding task with an external test suite**                                            | `reflection` vs `base` on a task with a verifier nobody wrote locally                          | credential; a scenario with `oracleCommands`       |
| 4   | **`full-stale-asset`** on a scenario the stale asset gets wrong                                        | Correct-override vs lucky-ignore — the challenge path                                          | harness (the arm must actually differ from `full`) |

Scenario 1 is the highest-information one and the furthest away. Scenarios 2 and
4 need no credential and are reachable as soon as the arm seeding exists.

## 6. What would falsify this document

- A single live run in any `NOT TESTED` cell would make its row stale, and this
  file should be regenerated from manifests rather than edited by hand. The
  manifests are the source of truth; this is a view of them.
- If the `full-stale-asset` and `full-no-asset` arms are implemented and produce
  _identical_ metrics to `full`, then §2's E and F arms are not experiments and
  the brief's ablation requirement is unmet — a finding worth recording rather
  than a bug worth hiding.
