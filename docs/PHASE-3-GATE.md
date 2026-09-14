# Phase 3 Gate Record

Status: PASS (bounded local implementation; Phase 4 conditional). This is not a production-readiness claim and does not close the owner-input boundary below.

## Scope

Phase 3 implements the Bible's EPIC-005 and EPIC-006 boundary:

- explicit-expectation outcome residuals;
- subscription- and cursor-aware timing residuals;
- declared event/checkpoint rule residuals;
- independent `magnitude`, `confidence`, `persistence`, and `effect` fields;
- `unknown` as the automatic effect default;
- bounded and deterministic reflection with `STOP`, `CONTINUE`, and `ESCALATE`;
- support, counterevidence, testability, and estimated-cost fields for hypotheses;
- hard depth, hypothesis, tool-call, and elapsed-time budgets;
- runtime recording of `residual.detected` and `reflection.proposed` without action execution;
- canonical contract validation before every EventWriter batch, plus migration-0006 preflight and SQLite triggers for derived-event integrity;
- timing cursor binding to the ledger, reflection round cursor chaining, and no-delete protection for derived events;
- versioned JSON interchange shapes for expectations, residuals, and reflection proposals, with checked STOP/CONTINUE/ESCALATE and action-permission mappings.

## Non-goals retained

Phase 3 does not authenticate caller-declared actors, implement the final ACL, expose production human-control APIs, run provider SDKs, execute reflection actions, promote assets, import legacy data, or claim Node `22.13.0` evidence. The `requiredPermission` field on an action proposal is a routing label, not authorization.

## Runtime boundary

`ResidualDetector` and `ReflectionController` are pure domain modules. They do not import the store, runtime, agents, adapters, network, or tool APIs. `Phase3Runtime` is the explicit composition/use-case boundary for recording derived events. A reflection proposal must reference a matching `residual.detected` event; no proposal path writes an active Rule, Skill, Workflow, or Asset.

## Acceptance criteria

1. No outcome residual is emitted without an explicit expectation; predicate/external expectations require an explicit verification result.
2. Timing residuals require the relevant subscription plus both sequence and wall-clock thresholds.
3. Rule residuals inspect only declared event types/checkpoints in the requested trace.
4. Automatic effect remains `unknown`; weak verification and high-consequence/hard-to-reverse work escalate.
5. A repeated reflection call with no new evidence returns `STOP` and does not create hypotheses or actions.
6. Reflection output cannot exceed hard budgets and never executes an action.
7. Missing evidence, detached residual events, duplicate content conflicts, and raw context-event bypasses fail explicitly.
8. Concurrent workers produce one shared residual event and one shared proposal event when the logical actor and payload are stable; mismatched actors remain conflicts.

## Local evidence

Current-worktree evidence:

- residual unit tests: 5/5;
- reflection unit tests: 5/5;
- Phase 3 integration tests: 9/9;
- Phase 2 low-level context/runtime and event-store tests: 5/5 and 14/14;
- full test suite: 51/51 across 9 test files;
- system Node `v24.15.0`: full `pnpm verify` PASS;
- bundled Node `v24.19.0`: full `pnpm verify` PASS;
- both verification runs include format, lint, workspace/dependency boundaries, typecheck, build, schema parity, four-process Phase 1 concurrency, crash recovery, 10,000 append, Phase 2 replay/context, and Phase 3 residual/reflection scenarios;
- `pnpm phase3:scenario`: PASS, including same-database idempotency, concurrent no-false-positive, repeated no-self-call, ledger-bound timing, and timeout/close behavior.

Node `22.13.0` remains an external-runner evidence boundary. The current local evidence is deliberately reported as Node 24 evidence and is not substituted for the required Node 22 check.

The final current-worktree closeout review returned `ENGINEERING PASS` with no new Critical/High findings and `THEORY PASS` / `BOUNDARY PASS` for the bounded Phase 3 scope. The reviewers confirmed that the earlier negative-cursor, timing evidence, and future-evidence preflight findings are now covered by implementation and regression tests.

## Three-way review

1. Bible: PASS for the bounded EPIC-005/006 issue order, explicit baselines, bounded budgets, runtime-only event writes, and no automatic promotion.
2. The Final source materials: PASS for preserving lag, mismatch, breakpoint, reflection delay, asynchronous multi-agent positions, source ownership, and human subjectivity as engineering constraints rather than claiming solved theory.
3. `docs/断点记录.md`: PASS for BP-023 through BP-029, including trigger-fixture failures, canonical validation, timing/round cursor binding, Node/TLS boundary, actor/idempotency conflict, source-path correction, and the human-input gate.

## Phase 4 entry conditions

Before asset promotion begins, close or explicitly decide the human-only inputs in [`PHASE-3-INPUTS.md`](./PHASE-3-INPUTS.md): trusted writer/ACL, human-control API semantics, expectation time/resolution semantics, real sanitized asynchronous golden cases and external verification, production assembly, privacy/purge policy, and Node `22.13.0` runner evidence. These are one bounded Phase 4 entry package, not indefinite unscoped deferrals. No Phase 4 implementation may silently substitute synthetic fixtures for those decisions.
