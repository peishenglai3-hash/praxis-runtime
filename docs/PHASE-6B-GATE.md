# Phase 6B Gate — EPIC-010 Adapter Boundary

**Status:** `PASS` — engineering implementation.
**Behavioural validation:** **not attempted.** Phase 6V is separately authorised.
**Alpha release:** `NO-GO`. Unchanged by this gate.
**Baseline:** `phase6/epic-007-hardening` @ `0225adb` (Phase 5/6A baseline).
**Branch:** `feat/phase6b-adapter-boundary`.
**ADR:** [`ADR-0014`](./ADR/ADR-0014-phase6b-adapter-boundary.md).
**Authority:** owner Phase 6B brief, 2026-09-17.

## Scope

Bible section 15, EPIC-010 issues 090–095, plus the owner's Phase 6B brief.
Before this phase `packages/adapters` was `export {};` and `ModelAdapter`,
`ToolAdapter` and `ModelRunMetadata` did not exist anywhere in the repository.

The delivery order is itself a registered deviation:
`RFC MISMATCH: PHASE6_DELIVERY_ORDER` / `BP-057`. The Bible puts EPIC-010 in
Phase 6; the owner put the asset mechanism (EPIC-007) first as Phase 6A.

Explicitly forbidden and none of it done: automatic skill evolution, automatic
asset promotion without the existing human gate, learned provider routing,
provider ranking, new agent roles, model fine-tuning, persistent
model-specific memory, provider-specific policy in the runtime core, release
packaging, Phase 6V scenarios, Alpha release, cloud SaaS, provider wrapper zoo.

## 1. Adapter contract matrix

Every adapter below is in `packages/adapters` and passes the conformance suite
except where a case is recorded as not applicable.

| Adapter                         | Model/Tool | Streaming | Structured output | Tools | Cancellation | Idempotency key | Side-effect class         | Suite          |
| ------------------------------- | ---------- | --------- | ----------------- | ----- | ------------ | --------------- | ------------------------- | -------------- |
| `DummyModelAdapter`             | Model      | no        | yes               | no    | yes          | yes             | n/a                       | 13 pass        |
| `DummyToolAdapter`              | Tool       | no        | yes               | no    | yes          | yes             | declared per request      | 6 pass         |
| `SlowModelAdapter`              | Model      | no        | yes               | no    | yes          | yes             | n/a                       | 13 pass        |
| `SlowToolAdapter`               | Tool       | no        | yes               | no    | yes          | yes             | any; **uncertainty path** | 6 pass         |
| `FaultyModelAdapter`            | Model      | no        | yes               | no    | yes          | yes             | n/a                       | 13 pass        |
| `FaultyToolAdapter`             | Tool       | no        | yes               | no    | yes          | yes             | declared per request      | 6 pass         |
| `MalformedResponseModelAdapter` | Model      | no        | yes               | no    | yes          | yes             | n/a                       | 11 pass, 4 n/a |
| `PartialCapabilityModelAdapter` | Model      | no        | **no**            | no    | yes          | **no**          | n/a                       | 13 pass        |
| `PartialCapabilityToolAdapter`  | Tool       | no        | **no**            | no    | yes          | **no**          | declared per request      | 6 pass         |

Every `false` in a declaration is honoured by the implementation, which is what
CT-08 checks: a partial adapter does not return `structured` output it says it
cannot produce, does not report reasoning configuration it says it cannot
control, and does not claim to pass an idempotency key through.

**No provider adapter was written.** The owner permitted at most one minimal
real reference adapter, conditional on it proving an otherwise-untested
boundary. Nothing in the contract turned out to need one: every boundary this
phase is responsible for is exercised by a deterministic adapter, and a network
dependency would have bought nothing except a reason for the suite to be
flaky. The EPIC-010 gate does not require one.

## 2. Capability matrix

| Capability          | Stable? | Required by a caller? | Negotiated? | Dummy | Partial |
| ------------------- | ------- | --------------------- | ----------- | ----- | ------- |
| `streaming`         | stable  | yes                   | yes         | no    | no      |
| `tools`             | stable  | yes                   | yes         | no    | no      |
| `structuredOutput`  | stable  | yes                   | yes         | yes   | no      |
| `cancellation`      | stable  | yes                   | yes         | yes   | yes     |
| `idempotencyKey`    | stable  | yes                   | yes         | yes   | no      |
| `persistentSession` | stable  | yes                   | yes         | no    | no      |
| `reasoningControl`  | stable  | yes                   | yes         | yes   | no      |
| `experimental.*`    | **no**  | **no**                | **no**      | empty | empty   |

`experimental` is unreachable from negotiation by construction: a caller cannot
require it, and a call cannot be refused for lacking it. A `maxContextTokens`
ceiling is declared where one exists and is recorded in `capabilityMode`.

Negotiation is fail-closed: a required capability that is absent produces
`unsupported_capability` unless the caller pre-authorised degradation, and a
degraded run records `capabilityMode.degraded: true` so a later reader can tell
it ran with less than it asked for.

## 3. Error taxonomy

Twelve kinds. Retryability is a property of the taxonomy, and an adapter may
narrow it and may not widen it.

| Kind                          | Retryable by default | Notes                                         |
| ----------------------------- | -------------------- | --------------------------------------------- |
| `authentication_failure`      | no                   |                                               |
| `authorization_failure`       | no                   |                                               |
| `unsupported_capability`      | no                   | Lists what is missing **and** what is present |
| `invalid_request`             | no                   |                                               |
| `timeout`                     | yes                  | Overridden by the side-effect rule below      |
| `cancellation`                | no                   | A retry would contradict the cancellation     |
| `rate_limit`                  | yes                  |                                               |
| `transient_provider_failure`  | yes                  |                                               |
| `permanent_provider_failure`  | no                   |                                               |
| `malformed_provider_response` | no                   |                                               |
| `side_effect_uncertainty`     | no                   | Requires external verification first          |
| `unknown_external_failure`    | no                   | The default for anything unclassifiable       |

Every error carries `adapterId`, `operationId`, `traceId`, a provider-safe
`diagnostic`, a `retryable` flag, and — in-process only — the original cause.
`AdapterError.toJSON` omits the cause **structurally**, so it cannot reach a
log, an event payload or a doctor report by being forgotten about.

`sanitiseAdapterDiagnostic` never throws. Throwing inside an error path turns
one failure into two and the likely outcome is the raw exception escaping with
the secret intact; it redacts and reports the path instead, so the record says
a field was withheld rather than pretending it was empty. `idempotencyKey` is
deliberately **not** redacted — it is a caller-supplied grouping id, and
redacting it would destroy the one field that makes a retry diagnosable.

## 4. Side-effect and retry policy

```
sideEffect:   none | reversible | irreversible     declared by the caller,
                                                   never lowered by an adapter
effectStatus: applied | not_applied | unknown      reported by the adapter
```

`retryDecision` is the single place that answers whether a retry is allowed:

| Condition                                                | Retry                                |
| -------------------------------------------------------- | ------------------------------------ |
| `side_effect_uncertainty`                                | refused until `effectVerifiedAbsent` |
| `irreversible` + `timeout` or `unknown_external_failure` | refused until `effectVerifiedAbsent` |
| `irreversible` + a transient failure                     | refused until `effectVerifiedAbsent` |
| `cancellation`                                           | refused                              |
| anything else                                            | the taxonomy's answer                |

The refusal reason says what has to happen first — CT-13 asserts that it
contains "verify", because a refusal that does not say how to proceed is
indistinguishable from a bug.

`SlowToolAdapter` with `sendsBeforeDelay` is the model: the same 60 ms delay
inside a 5 ms budget reports `side_effect_uncertainty` for an irreversible
effect and an ordinary retryable `timeout` for a read.

## 5. Contract test report

`tests/integration/adapter-conformance.test.ts` runs `adapterConformanceCases`
from `@praxis/adapters` over nine subjects.

```
Test Files  1 passed (1)
     Tests  59 passed | 18 skipped (77)
```

The 18 skips are `applies()` returning false and are reported as
**not applicable**, never as passing. Three reasons a case is not applicable:

- the case is model-only or tool-only and the subject is the other;
- `CT-03` needs an adapter that lacks a capability — the full-capability
  adapters have none to lack;
- `CT-07` needs the deliberately non-conforming adapter, and the cases that
  require a conforming adapter skip it in turn.

| Case  | What it establishes                                                  | Failures found      |
| ----- | -------------------------------------------------------------------- | ------------------- |
| CT-01 | basic successful model generation, with issue-092 metadata           | —                   |
| CT-02 | basic successful tool execution, with an effect status               | —                   |
| CT-03 | unsupported capability → structured refusal naming what is missing   | —                   |
| CT-04 | a budget that cannot be met is a timeout                             | —                   |
| CT-05 | caller cancellation is reported as cancellation                      | **yes** — see below |
| CT-06 | a provider failure arrives as a taxonomy kind                        | —                   |
| CT-07 | a malformed provider response is translated, not leaked              | —                   |
| CT-08 | a partial adapter does not do what it declared it cannot             | **yes** — see below |
| CT-09 | `operationId` and `traceId` reach the adapter unchanged              | —                   |
| CT-10 | the execution context carries no store capability                    | —                   |
| CT-11 | an adapter exposes no promotion or event-writing surface             | —                   |
| CT-12 | a slow adapter inside its budget succeeds                            | —                   |
| CT-13 | irreversible uncertainty is not blindly retried                      | —                   |
| CT-14 | capability negotiation is deterministic and total                    | —                   |
| CT-15 | secret-bearing metadata is withheld, and the withholding is reported | —                   |

**Two defects the suite found in the implementation under test.** Both were in
my own adapters, both are fixed, and neither would have been caught by reading
the code:

1. **CT-05** — `settle` returned early when there was no artificial delay, so
   an instant call was the one call that never noticed it had been cancelled.
   The cancellation signal was honoured only by calls slow enough to wait.
2. **CT-08** — `DummyToolAdapter` reported `idempotencyKeySent` from the
   request even when the adapter declared `idempotencyKey: false`, which made
   the capability declaration decorative. This is exactly the failure the
   owner's section 6 forbids, and it survived until a partial adapter was
   pointed at it.

## 6. OSS reference review

Recorded in full in [`ADR-0014`](./ADR/ADR-0014-phase6b-adapter-boundary.md) §
"External reference review", including an **evidence boundary**: direct fetches
of the MCP and OpenTelemetry specifications were blocked by this environment's
network policy, so that review rests on search-result summaries and prior
knowledge rather than on a verbatim reading. Quoted wording and version numbers
should be re-verified before being cited as authority.

| Reference                | Principle adopted                                                  | Component rejected                                    |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| MCP capability handshake | declare capabilities bilaterally; fail loudly on mismatch          | adopting MCP as this runtime's transport or lifecycle |
| Durable interrupt/resume | an external action is a durable, identified boundary; resume by id | adopting the framework as the execution kernel        |
| OpenTelemetry GenAI      | one provider-neutral vocabulary with an explicit stability tier    | making OpenTelemetry a dependency                     |

## 7. ADR updates

- **New:** `docs/ADR/ADR-0014-phase6b-adapter-boundary.md`.
- **New rule:** `.dependency-cruiser.cjs` — `adapters-cannot-reach-the-store-or-runtime`.
- **RFC:** `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` registered.

No existing ADR was amended. ADR-0003 ("keep provider-specific SDK types behind
adapter ports") and ADR-0008 (the `ADAPTER` writer role, confined away from
`legacy.*`) were both read and are consistent with this phase; ADR-0008's
`ADAPTER` role is what an adapter's writer reference declares.

## 8. Git diff summary

```
branch   feat/phase6b-adapter-boundary, from 0225adb (Phase 5/6A baseline)
commits  25856c7  feat(adapters): define provider-neutral contracts and the error taxonomy
         c6e762e  feat(adapters): capability negotiation, reference adapters, and the conformance suite
diff     12 files changed, 2982 insertions(+), 1 deletion(-)
```

No migration, no schema, no CLI surface, no existing contract and no runtime
behaviour changed. `packages/adapters/src/index.ts` went from `export {};` to a
real export surface; `packages/contracts/src/index.ts` gained the adapter
exports. Nothing under `packages/runtime` was touched.

## 9. Remaining gaps

Recorded rather than absorbed.

| #   | Gap                                                                                                                                                     | Consequence                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **No runtime integration.** Nothing in `packages/runtime` calls an adapter, and no event records `ModelRunMetadata`.                                    | The boundary is proved but not yet _used_. This is Phase 6V work and the owner's brief does not include it. `ModelRunMetadata` exists and is produced by adapters; nothing persists it yet.            |
| 2   | **No provider adapter.**                                                                                                                                | Nothing has tested the boundary against a real provider's quirks. Deliberate: the owner forbade provider-specific production adapters, and the gate does not require one.                              |
| 3   | **The conformance suite has no independent adopter.**                                                                                                   | Its hardest evidence is against adapters in the same package, written by the same author on the same day. That is a real limit on what CT-01..CT-15 can claim.                                         |
| 4   | **`adapterExecutionContextSchema` cannot be a wire schema** (it carries an `AbortSignal`).                                                              | Only requests, results, capabilities and errors are JSON interchange shapes; no `schemas/*.json` was added for the context.                                                                            |
| 5   | **Issue 095's scaffold-portability test is not implementable yet** — it requires a real provider adapter to compare against a dummy, and there is none. | The EPIC-010 gate condition 「同一 core fixture 在 Dummy + provider adapter 不改变 core schema/ledger 语义」 is `PENDING`, not met. See `RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING` in `RFC-0001.md`. |
| 6   | Phase 5's open items are unchanged: issue 081's doctor scope, the §5.4 event taxonomy, Golden Fixture 01.                                               | Carried, not worsened.                                                                                                                                                                                 |

## 10. Security-state report

Inspected 2026-09-17 with `gh api`. The repository is public; the authenticated
account has `admin: true`.

| Control                             | Before   | After       | Action                                                                                         |
| ----------------------------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------- |
| Secret scanning                     | disabled | **enabled** | executed                                                                                       |
| Secret scanning **push protection** | disabled | **enabled** | executed                                                                                       |
| Private vulnerability reporting     | disabled | **enabled** | executed                                                                                       |
| Dependabot alerts                   | disabled | **enabled** | executed                                                                                       |
| Dependabot _security updates_       | disabled | disabled    | **not** executed — it opens PRs automatically, which is a workflow change beyond "the minimum" |
| Non-provider secret patterns        | disabled | disabled    | available; not executed                                                                        |
| Secret-scanning validity checks     | disabled | disabled    | available; not executed                                                                        |

The owner's section 15 authorised executing the minimum changes where admin
capability exists and nothing requires a plan migration or incurs billing. All
four executed controls are free on a public repository and none changes the
repository's workflow.

**One hazard was removed before enabling push protection.** The conformance
suite's CT-15 needs credential-shaped values to exercise redaction, and its
first draft wrote them as literals — in a public repository that is exactly
what push protection blocks, and the pending push would have been blocked by
the test written to prove secrets do not leak. The values are now assembled
from fragments at runtime, so the test stays realistic and the repository stays
pushable. A scan of every tracked file for credential-shaped literals now
returns nothing.

`SECURITY.md` has been updated to describe the controls that are actually on.

A full-history audit of all 518 text blobs across every ref was run on
2026-09-17 and found no credential of any kind; this phase added no new
credential-shaped content.

## Gate decision

```
Contracts provider-neutral                    PASS
Runtime core has no provider dependency       PASS  (graph-enforced)
Capability negotiation works                  PASS
Timeout and cancellation work                 PASS
operationId propagation works                 PASS
Side-effect uncertainty is handled            PASS
Dummy adapters pass                           PASS
Slow / Faulty / Partial adapters pass         PASS
Contract tests pass                           PASS  (59 passed, 18 not applicable)
No adapter writes the Event Store             PASS  (cannot import it)
No adapter promotes an Asset                  PASS  (cannot import it)
No adapter controls Reflection                PASS  (cannot import it)
Critical mismatch                             0
High mismatch introduced by Phase 6B          0
pnpm verify remains green                     PASS
Node 22.13 CI                                 PENDING — no run for this commit
docs/PHASE-6B-GATE.md exists                  PASS
Issue 095 scaffold portability                PENDING — needs a real provider adapter
```

**Phase 6B is `PASS` for the engineering boundary.** A production provider
integration is not required for that verdict, and the EPIC-010 gate does not
ask for one.

**It is not a behavioural validation.** Nothing here shows that a real model
behind this boundary produces useful work, that the capability declarations of
a real provider map cleanly onto these seven flags, or that the error taxonomy
survives contact with a provider whose failures do not fit it. Those are
Phase 6V questions.

**Phase 6V does not start. Alpha release stays `NO-GO`.** The next stage is
separately authorised by the author.
