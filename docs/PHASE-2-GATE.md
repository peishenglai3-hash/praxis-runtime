# Phase 2 Gate Record

Status: PASS for the bounded local Phase 2 implementation; conditional on separate Node.js `22.13.0` runner evidence and deferred production/authentication boundaries.

## Scope

Phase 2 implements the Bible's EPIC-003 and EPIC-004 boundary:

- a pure, deterministic `Projection<TState>` reducer contract over immutable event records;
- versioned projection state/data persistence, observable `lastSeq`, snapshots, and transactional staging rebuild;
- incremental catch-up from `lastSeq + 1`, recoverable reducer/persistence failure results, and version-mismatch rebuild;
- core Project, Rule, Asset, and Agent cursor projections without treating derived state as an event fact;
- `reuse`, `reindex`, and `refresh` context planning modes;
- versioned, explainable ranking weights with the Bible's MVP formula;
- core character-count token estimation through the `TokenBudgetEstimator` port;
- exposure proposals returned by the planner and plan/exposure event recording at the runtime composition root;
- a concurrent replay/context scenario fixture, including same-database projection writer competition.

## Non-goals retained

Phase 2 does not implement residual detection, reflection, asset promotion, legacy import, authenticated writer identity, provider SDKs, learned routing, or privacy purge. Context has no dependency on the residual package, and the planner does not write to the event store directly.

## Local evidence

The repository gate is:

```powershell
pnpm verify
```

In addition to the Phase 0/1 checks, the Phase 2 suite currently covers 30 unit/integration tests, projection loss/rebuild, snapshot version mismatch, failed versioned rebuild preservation, core projection replay, all three context modes, ranking explanations, token budgeting, runtime plan/exposure recording, forged and incomplete plan/exposure rejection, timestamp ordering, and concurrent isolated and same-database replay/context scenarios.

## Three-way review requirements

1. Bible: projection state is rebuildable, `lastSeq` is explicit, snapshots never delete events, and context selection is deterministic and explainable.
2. The Final: derived state and exposure-influenced material remain distinguishable from direct observation; later promotion must not be inferred from this phase.
3. `docs/断点记录.md`: Phase 2 failures, repairs, and unresolved boundaries are recorded in BP-020 through BP-022 before the gate is closed.

## Final review record

- Engineering red-team findings were initially `NO-GO`, then closed by CAS/cursor guards, complete plan/proposal membership checks, explicit `REFRESH` input, build-time ledger bounds, timestamp ordering, and same-database projection concurrency evidence.
- Theory/boundary review is `PASS` for this bounded Phase 2 scope: plan and exposure remain candidate/inferred material with source/evidence/links; no automatic promotion or consensus path was added.
- Both reviewers retain the deferred boundary that caller-declared actors are not authenticated writers and that human control APIs, production adapter assembly, and CLI/daemon use cases are later work. Those omissions are not counted as Phase 2 capabilities.

## Local evidence record

The final local verification target is system Node.js `v24.15.0` and bundled Node.js `v24.19.0`, both with `node:sqlite` available. On the clean Phase 2 checkpoint, `pnpm verify` exited with code 0 on both runtimes. Each run reported 30 tests, Phase 1 concurrency/crash/10,000 append success, and the Phase 2 replay/rebuild/context plus same-database projection scenario; the recorded throughput was 32,711 ms on system Node and 33,259 ms on bundled Node. These timings are environment evidence, not a performance promise. Node.js `22.13.0` is not claimed locally because source code has not been uploaded to the private remote.

## Deferred gates

- JSON Schema/runtime validator parity before admitting external producers;
- residual/context interaction through an explicit runtime signal port only;
- projection data entity decomposition beyond the current root entity fixture;
- production-scale WAL pressure, privacy purge, authenticated writers, and legacy migration;
- production SQLite/config/clock/id/actor assembly and user-facing CLI/daemon workflows;
- Node 22.13.0 CI evidence, which remains separate from local Node 24 evidence.
