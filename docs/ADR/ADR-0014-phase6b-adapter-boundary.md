# ADR-0014: The provider adapter boundary

**Status:** Accepted for Phase 6B
**Scope:** Bible EPIC-010, issues 090–095
**Gate:** `docs/PHASE-6B-GATE.md`
**Phase:** 6B (owner-frozen delivery order; see `RFC MISMATCH: PHASE6_DELIVERY_ORDER`)

## Context

Bible section 10.2 freezes two ports and four constraints:

```
interface ModelAdapter { generate(request: ModelRequest): Promise<ModelResult>; }
interface ToolAdapter  { execute(request: ToolRequest): Promise<ToolResult>; }
interface Clock { now(): Date; }
interface IdGenerator { next(): string; }
interface TokenBudgetEstimator { estimate(text: string, modelHint?: string): number; }
```

- 「核心 DTO 禁止包含 OpenAI/DeepSeek/Gemini SDK 类型。」
- 「每次模型调用记录 ModelRunMetadata：provider、model、reasoning/effort 配置、scaffold、
  tool schema version、prompt/config hash。」
- 「ToolAdapter 外部副作用必须接受 operationId；如果 provider 支持原生 idempotency
  key，必须透传。」
- 「先实现 DummyModelAdapter/DummyToolAdapter，使核心全部测试不依赖联网服务。」

Section 15's EPIC-010 risk row adds the reason this is a boundary problem and not
an integration problem: 「Provider SDK 类型泄漏到核心会锁死 OpenAI/DeepSeek；Replay
缺少 model/scaffold metadata 会被误解为真实历史重演。」

At the start of this phase `packages/adapters` was `export {};`, and
`ModelAdapter`, `ToolAdapter` and `ModelRunMetadata` did not exist anywhere.
`TokenBudgetEstimator` and `Clock` already did.

## Decisions

### 1. The ports take an execution context

Bible section 10.2 shows a one-parameter signature. The implementation takes a
second `AdapterExecutionContext` — `operationId`, `traceId`, `timeoutMs`,
`signal`, `actor`, `writer`.

This is a **change to a frozen port**, registered as
`RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2` rather than absorbed. It is
not cosmetic: section 10.2 already requires a ToolAdapter to accept an
`operationId`, and the Phase 6B brief requires timeout, cancellation and
provenance to be first-class. Folding those into the request DTO would put "how
long do we have" and "can this be cancelled" into the description of the work,
and the same request must be runnable under different conditions.

### 2. Capabilities are declared, required, and negotiated fail-closed

```
forbidden:  if (provider === "openai") ...
preferred:  if (capabilities.structuredOutput) ...
```

Every stable capability is a **required boolean**. An adapter that has not
decided whether it supports cancellation does not get to leave the question
blank — a declaration is a statement, and an omission is not.

`experimental` is a separate map rather than more top-level fields, so an
experimental capability cannot be required by a caller, cannot be negotiated,
and cannot become load-bearing by accident.

A call that requires an absent capability is refused with
`unsupported_capability`, naming what is missing **and what the adapter does
have**. The second half matters: a caller who only learns what is missing has
to guess at a provider name to recover, which is the thing this decision
exists to prevent. Degradation happens only when the caller said
`allowDegradation` in advance, and the resulting run records
`capabilityMode.degraded: true`.

### 3. One error taxonomy, and adapters cannot widen it

Twelve provider-neutral kinds. An adapter that throws a foreign error is not
trusted to have classified it: `asAdapterError` demotes anything unrecognised
to `unknown_external_failure`, which permits nothing.

An adapter may **narrow** retryability and may not widen it — claiming a
permanent failure is transient is how a blind retry loop starts. `retryDecision`
is the single place that answers "may this be tried again", and it is what
makes the side-effect rule enforceable rather than advisory.

### 4. Side effects are classified, and uncertainty is a first-class answer

`sideEffect: none | reversible | irreversible` is declared by the caller, and
an adapter must not lower it. `effectStatus: applied | not_applied | unknown` is
reported by the adapter.

An irreversible operation whose outcome is unknown — a timeout after the call
was sent — is reported as `side_effect_uncertainty`, not `timeout`, and
`retryDecision` refuses the retry until the caller has verified the external
state. `SlowToolAdapter` models the distinction precisely with
`sendsBeforeDelay`: the same delay on a read is an ordinary retryable timeout.

### 5. `ModelRunMetadata` carries `counterfactual`

Section 15's risk row says a replay missing model/scaffold metadata 「会被误解为
真实历史重演」. The metadata records provider, model, reasoning configuration,
scaffold, tool-schema version, a **prompt hash rather than the prompt**, a config
hash, the capability mode actually used, and a `counterfactual` flag. A
counterfactual run is not history and now says so.

### 6. The boundary is enforced by the dependency graph, not by a check

`adapters-cannot-reach-the-store-or-runtime` forbids `packages/adapters` from
importing `store`, `state`, `context`, `residual`, `reflection`, `assets`,
`agents` or `runtime`. An adapter that cannot import the store cannot write to
it; one that cannot import the runtime cannot promote through it. That is a
stronger statement than any runtime check, and it is the one the EPIC-010 gate
asks for.

`packages/adapters` is deliberately **absent** from
`core-does-not-depend-on-provider-sdks`. ADR-0003 says provider SDK types stay
_behind adapter ports_; keeping them out of the other packages achieves nothing
if they are also kept out of the only place meant to have them.

### 7. The execution context carries a writer reference, not a capability

`AdapterWriterRef` is `{ writerId, kind, role }`. An adapter has no use for a
`WriterContext` and every reason not to hold one: it is given what it needs to
label a diagnostic and nothing that could be mistaken for an authorization.
CT-10 asserts the absence structurally.

## External reference review (Phase 6B, owner section 11)

The owner required a review of three mature designs for **principles, not
frameworks**.

**Evidence boundary, recorded rather than glossed.** Direct fetches of
`modelcontextprotocol.io`, `modelcontextprotocol.org` and `opentelemetry.io`
were blocked by this environment's network policy. The review below is
therefore grounded in search-result summaries and prior knowledge of the
specifications, not in a verbatim reading of the normative text. Quoted
wording and exact version numbers should be re-verified against the sources
before any of it is cited as authority. The principles adopted are ones this
repository can justify on its own terms, which is why the review is usable
despite the boundary.

### A. MCP-style lifecycle and capability negotiation

_What was examined:_ an initialize handshake in which each side declares a
capability object, a protocol version is negotiated with fallback to a
supported version, and features a peer did not declare are simply not used.

_Principle adopted:_ **declare capabilities bilaterally and fail loudly on a
mismatch** — do not infer support from an endpoint's identity, and do not
silently drop a requested feature.

_Components rejected:_ adopting MCP as this runtime's transport or lifecycle.
Praxis is a local-first ledger with its own event vocabulary and its own
sequencing; importing a protocol designed for tool-serving would put a second
lifecycle model beside the ledger and create a second source of truth about
what happened.

### B. Durable execution with interrupt and resume

_What was examined:_ checkpointed execution, `interrupt()` for conditional
pausing, resume keyed on a stable task identifier, and explicit guidance about
replay and idempotency across a resumed step.

_Principle adopted:_ **an external action is a durable, identified boundary** —
resuming must key on an identifier rather than re-running, and a step that
touches the outside world needs an idempotency story before it can be retried.
This is the direct ancestor of `operationId` propagation and of
`side_effect_uncertainty`.

_Components rejected:_ adopting the framework as this runtime's execution
kernel. Bible section 10.3 already fixes the composition root and the use-case
list; a second scheduler would compete with it, and the owner's brief forbids
introducing a provider-specific policy into the runtime core.

### C. OpenTelemetry semantic conventions for generative AI

_What was examined:_ a provider-neutral attribute vocabulary
(`gen_ai.provider.name`, `gen_ai.operation.name`, request/response model
attributes), an explicit distinction between attributes marked stable and those
marked experimental, and scoping for provider-specific detail.

_Principle adopted:_ **one vocabulary across providers, with an explicit
stability tier** — a core field named after a vendor is a vendor decision that
has been mistaken for a design. Hence `AdapterObservation` has `adapterId`,
`provider`, `target`, `operationId`, `traceId`, `startedAt`, `durationMs`,
`status`, `errorKind`, `usage`, `capabilityMode` and a scoped
`providerMetadata` bag — and no `openaiLatency`, ever.

_Components rejected:_ making OpenTelemetry a dependency. The owner's brief
says not to make it mandatory unless an existing need justifies it; this
repository has no exporter and no collector, and a dependency adopted for a
vocabulary would be a dependency adopted for nothing.

## Consequences

- A provider adapter can be added without touching the runtime core, and the
  conformance suite is the acceptance test rather than a bespoke review.
- The suite ships in `@praxis/adapters` and takes an assertion interface, so a
  future adapter author can run it without depending on this repository's test
  tooling and without making Vitest a production dependency.
- Provider-neutrality is checkable: CT-03 asserts mechanically that files
  under `packages/adapters/src` name no provider outside comments.
- **The boundary has no runtime integration yet.** Nothing in
  `packages/runtime` calls an adapter; that is Phase 6V work and is recorded as
  a remaining gap rather than implied by this ADR.
- `adapterExecutionContextSchema` cannot be a wire schema, because it carries
  an `AbortSignal`. Only requests, results, capabilities and errors are JSON
  interchange shapes.

## Rejected alternatives

- **A `provider` field on the request.** It would become the branch condition
  the capability declaration exists to replace.
- **Optional capability booleans.** An unanswered question would be
  indistinguishable from a "no".
- **Throwing raw provider exceptions with a wrapper.** The runtime would then
  have to pattern-match vendor error strings, which is the leak the taxonomy
  prevents.
- **Returning `effectStatus: "not_applied"` on an irreversible timeout.**
  It would be a guess presented as an observation, and it is the specific
  mistake that makes a blind retry look safe.
- **Putting the dummy adapters in the test layer.** Bible section 10.2 asks for
  them as the thing that lets the core be tested without a network; a dummy
  that only tests can reach is not that.
