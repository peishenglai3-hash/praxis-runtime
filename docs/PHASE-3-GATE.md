# Phase 3 Gate Record

Status: IMPLEMENTATION CANDIDATE; final gate requires the two read-only reviews and the full `pnpm verify` result recorded below.

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
- low-level SQLite integrity triggers that prevent context plan/exposure EventWriter bypass;
- versioned JSON interchange shapes for residuals and reflection proposals.

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

Targeted evidence already recorded:

- residual unit tests: 4/4;
- reflection unit tests: 5/5;
- Phase 3 integration tests: 4/4;
- Phase 2 low-level context/event-store tests: 5/5 and 12/12;
- `pnpm phase3:scenario`: PASS, including four-process same-database idempotency and concurrent no-false-positive/no-self-call checks;
- TypeScript build and typecheck: PASS after the Phase 3 runtime bridge;
- Node `v24.15.0` is the system verification runtime; bundled Node `v24.19.0` remains a second local runtime.

The final full verification command and the two reviewer conclusions must be appended before this gate is changed to `PASS`.

## Three-way review

1. Bible: verify EPIC-005/006 issue order, explicit baselines, bounded budgets, runtime-only event writes, and no automatic promotion.
2. The Final source materials: verify that lag, mismatch, breakpoint, reflection delay, asynchronous multi-agent positions, source ownership, and human subjectivity are preserved as engineering constraints rather than claimed as solved theory.
3. `docs/断点记录.md`: verify BP-023 through BP-027, including the trigger fixture omissions, Node/TLS boundary, actor/idempotency conflict, and human-input gate.

## Phase 4 entry conditions

Before asset promotion begins, close or explicitly decide the human-only inputs in [`PHASE-3-INPUTS.md`](./PHASE-3-INPUTS.md): trusted writer/ACL, human-control API semantics, real sanitized golden cases and external verification, production assembly, privacy/purge policy, and Node `22.13.0` runner evidence. No Phase 4 implementation may silently substitute synthetic fixtures for those decisions.
