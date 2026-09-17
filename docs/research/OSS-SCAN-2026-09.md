# OSS Architecture Scan — 2026-09

**Status:** reconnaissance — no dependency was added, no code was borrowed, no
runtime file was touched.
**Authority:** owner 6V-PREP brief, 2026-09-17, Track A.
**Phase 6V:** NOT STARTED.

## 0. Evidence boundary — read this before any finding below

The brief requires that external facts, inference, recommendation and
repository fact stay separate. It also requires honesty about what was actually
verified. Both matter here more than usual, because this scan found something
about its own method that changes how its results should be weighted.

**`WebFetch` is blocked in this environment.** It was attempted against
`github.com`, `docs.langchain.com`, `alfworld` and `huggingface.co`; all failed
with a domain-safety error.

**Shell-level `curl` works.** The Track A3–A6 scan established this and used it
against `raw.githubusercontent.com` and `api.github.com`, so **that track's
findings come from files actually read**, while the A1/A2 and Track B scans are
restricted to search-result summaries.

| Track | Evidence quality                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------- |
| A1/A2 | **Search summaries only.** No URL opened; no LICENSE file verified                                                    |
| A3/A6 | **Primary files read via `curl`** for most findings; a strict read-vs-fetched list is maintained in the source report |
| A4    | **Primary.** MCP schema and spec text read directly                                                                   |
| A5    | **Primary.** The GenAI conventions repository read directly                                                           |
| B     | **Search summaries only**                                                                                             |

Three consequences, stated rather than buried:

1. **No licence claim in the A1/A2 or Track B portions was verified against a
   LICENSE file.** Those are reported, not confirmed.
2. **No star count, version number or benchmark figure is evidence of anything**
   and none is used as such below.
3. **Two searches returned nothing at all**, and the second is important:
   `agent expectation prediction verifier mismatch residual anomaly detection
trajectory before action` returned no results. **The Expectation/Residual
   mechanism therefore has essentially no external comparison in this scan.**
   The absence of a "do not adopt" entry for it is an absence of evidence, not
   an endorsement.

---

## 1. A1 — Durable state, checkpoint, interrupt

### Temporal — event history, deterministic replay, side-effect boundary

```
Project:            Temporal
Repository:         temporalio/temporal
Licence:            MIT (reported, not verified against a LICENSE file)
Language:           Go core, multi-language SDKs
Relevant subsystem: Event history, workflow versioning, continue-as-new

Mechanism observed: Workflow state is reconstructed by replaying an event history.
                    Non-determinism is DETECTED, not assumed: the SDK compares the
                    commands a workflow emits against the events the server recorded and
                    raises NonDeterminismError on divergence. Activities (the side-effecting
                    steps) are made idempotent by rule, and history has a hard bound —
                    continue-as-new truncates at 51,200 events / 50 MB with explicit
                    state carry-over.

Similarity to Praxis: Replay-from-history is the same idea as the projection rebuild.
                      Activity idempotency is the same idea as operationId.

Difference from Praxis: Temporal DETECTS non-determinism at replay time; Praxis ASSERTS
                        determinism. Temporal polices clocks and RNG through its SDKs;
                        Praxis has no described equivalent. Temporal bounds history;
                        Praxis's ledger is unbounded.

Potentially adopt: principle + test pattern
  -> command-vs-observation comparison producing an explicit non-determinism error
  -> snapshot-equivalence tests
Do NOT adopt:     history-as-state for large payloads (Praxis already has the better answer)
Risk of adoption: Low — both are test-layer patterns, not dependencies
Praxis gap exposed: replay determinism is asserted and never verified
Needs Phase 6V validation? YES
Priority: HIGH
```

### LangGraph — checkpointer and store

```
Mechanism observed: Checkpoints are the state. `interrupt()` re-executes the node on
                    resume. The project's own position is that "replay is a resume, not
                    a cache read" — LLM calls are re-issued rather than replayed.
Similarity to Praxis: Checkpointing, thread identity, time travel.
Difference from Praxis: In LangGraph the checkpoint IS the source of truth. Praxis inverts
                        this: the ledger is the source of truth and every snapshot is
                        disposable. The two designs answer "what is true" differently.
Potentially adopt: nothing
Do NOT adopt:     checkpoint-as-source-of-truth; "replay is a resume"; re-executing model
                  calls behind a replay flag
Risk of adoption: Adopting either would erase the property Praxis exists to test
Priority: HIGH — as an explicit non-adoption
```

### Restate — journaled durable execution

```
Mechanism observed: `ctx.run()` journals the intent BEFORE executing the side effect, and
                    provides a seeded `ctx.rand.uuid4` so identifiers are reproducible.
Similarity to Praxis: This is the closest external match to "an Expectation is registered
                      before the act".
Difference from Praxis: It journals the call, not a verification criterion.
Potentially adopt: principle — deterministic, runtime-seeded identifiers
Do NOT adopt:     the runtime itself
Priority: MEDIUM
```

### CQRS / event sourcing — the classical corpus

```
Mechanism observed: Named projector types (live / catch-up / persistent / inline),
                    checkpoint tables, dead-letter queues, snapshot equivalence tests,
                    and five named schema-evolution techniques including upcasting.
Similarity to Praxis: Projection, snapshot, catch-up, rebuild are all standard named
                      patterns. Praxis is re-deriving a 15-year-old field.
Difference from Praxis: The classical corpus treats provenance and authorization as an
                        add-on. One formulation worth keeping: "an append-only table is not
                        automatically an audit trail."
Potentially adopt: principle + test pattern — upcasting; dead-letter handling
Do NOT adopt:     nothing specific
Praxis gap exposed: no event schema evolution / upcasting story at all
Priority: HIGH
```

---

## 2. A2 — Long-term and editable memory

### Graphiti / Zep — bi-temporal knowledge graph

```
Mechanism observed: Four timestamps per fact (system-time vs valid-time), automatic
                    LLM-driven contradiction invalidation on write, community compaction.
Reported defect:    A documented silent-fact-loss finding — approximately 70% of
                    auto-retired facts were still true (28 of 40), the LLM returns bare
                    indices with no justification, there is no shared-entity requirement,
                    and the failure is silent.
Similarity to Praxis: Temporal validity and invalidation are the same problems as challenge
                      and deprecate.
Difference from Praxis: Graphiti ASSERTS causation on every write. Praxis fixes
                        `effect: unknown` and refuses to.
Potentially adopt: principle — the four-timestamp vocabulary (system-time vs valid-time)
Do NOT adopt:     automatic LLM contradiction-invalidation; embedding-similarity candidate
                  matching; silent invalidation of any kind
Risk of adoption: The reported 70% false-retirement rate is the strongest available external
                  argument for Praxis's refusal to assert causation
Praxis gap exposed: no valid-time axis
Needs Phase 6V validation? YES — is `effect: unknown` actually protective, or does it just
                            move the judgement somewhere unrecorded?
Priority: HIGH
```

### Mem0 — the four-operation memory editor, and the ADD-only pivot

```
Mechanism observed: An LLM arbitrates ADD / UPDATE / DELETE / NOOP per memory. A history
                    table records the edits. In v3 the project moved to ADD-only with
                    retrieval-time decay.
Similarity to Praxis: A history table beside mutable current state.
Difference from Praxis: The derivative is authoritative. Mem0 shipped destructive editing
                        and retreated from it; Praxis never had it.
Potentially adopt: nothing
Do NOT adopt:     hard DELETE of memories; an LLM as memory editor with write authority
Significance:     A mature project arriving at append-first after shipping the alternative is
                  corroboration of the direction, and it is not proof of this implementation.
Priority: MEDIUM
```

### Letta — memory blocks and sleep-time agents

```
Mechanism observed: Editable memory blocks with tiers; a background "sleep-time" agent that
                    consolidates memory; `memory_rethink`-style rewrite.
Reported consequences: silent drift and poisoned consolidation.
Similarity to Praxis: Long-term memory edited over time.
Difference from Praxis: Letta's consolidation agent has DIRECT WRITE AUTHORITY. Praxis's
                        Reflection controller has no write port at all — it returns a
                        proposal and the runtime decides.
Do NOT adopt:     a background agent with direct write authority over promoted artifacts;
                  last-writer-wins rewrite
Priority: HIGH — as an explicit non-adoption
```

### The evidence-gated promotion cluster

Six independent projects — skill-evidence, CMM, MSCE, Skill-Evo4GUI, SkillsVote,
learned-skills-index — converge on the same gate: **evidence count + independence

- human ratification + refuse-if-insufficient.**

```
Potentially adopt: principle — the independence rule, stated precisely: "two
  observations are independent only if they come from distinct top-level sessions;
  multiple deviations within one run count as ONE observation."
Do NOT adopt: specific numeric thresholds from any of these projects
Praxis gap exposed: none — Praxis already implements the gate. What Praxis has that none
                    of them has is that the gate is LEDGER-NATIVE: every input is an event
                    rather than a record in a separate store.
Priority: MEDIUM
```

---

## 3. A3 — Agent runtime, action–observation

### OpenHands — EventLog

```
Repository:         OpenHands/OpenHands  (renamed from All-Hands-AI/OpenHands; the
                    repository is now TypeScript, and the Python agent core moved to
                    OpenHands/software-agent-sdk)
Licence:            MIT (reported)
Mechanism observed: The EventLog is a TREE, not a list — explicit `parent_id`,
                    `path_to_root`, cycle detection, with a legacy linear fallback. One
                    file per event plus flock, a monotonic integer index assigned at
                    append, a sidecar length marker, and a 30-second lock timeout.
                    Its own documentation admits the flock is unreliable on NFS.
Similarity to Praxis: Append-first, monotonic ordering, one writer.
Difference from Praxis: A tree with an explicit causal parent, where Praxis has
                        `links.causedBy`. The tree is a stronger structural claim than a
                        link list. **The append boundary takes no actor** — there is no
                        ACL at the point of writing, which Praxis enforces on every append.
Potentially adopt: principle — explicit causal parentage as a structural property rather than
  a link field; sidecar length markers as a cheap crash-detection aid
Do NOT adopt: the flock-based append (environment-dependent correctness)
Praxis gap exposed: `links.causedBy` is unenforced. Nothing checks that a causedBy
                    reference resolves, or that it points backwards.
Needs Phase 6V validation? YES
Priority: MEDIUM
```

### AutoGen Core — mailbox and subscriptions

```
Mechanism observed: An event-driven actor core with mailboxes and subscriptions. There is
                    NO ledger: `save_state()` is documented as "implementation defined";
                    `DropMessage` leaves no durable trace; `ignore_unhandled_exceptions`
                    defaults to True.
Potentially adopt: nothing
Do NOT adopt:     `InterventionHandler` as a policy seam — a transport middleware hook
                  available only on the single-threaded runtime (per its own docstring),
                  dropping via a marker type that leaves no record
Do NOT adopt:     the mailbox as a design for the runtime's own state
Praxis gap exposed: the Mailbox has no named failure vocabulary. AutoGen at least names
                    four: Undeliverable, CantHandle, MessageDropped, NotAccessible.
Priority: LOW for the runtime, MEDIUM as a checked gap
```

### smolagents

```
Mechanism observed: A minimal agent runtime with no neutral provider boundary at all.
                    Capability mismatches surface as backend-specific exceptions, and one
                    capability predicate hardcodes model-name lists.
Do NOT adopt:     anything
Priority: LOW — useful only as a second data point on how easily the boundary is skipped
```

---

## 4. A4 — Provider and tool protocol boundary

**This is the most consequential section of the scan**, because A4 is the only
track whose subject is a mechanism this project has just built and frozen.

### MCP — capability negotiation, versioning, error taxonomy

```
Mechanism observed: An initialize handshake declaring capabilities bilaterally; a protocol
                    version negotiated with fallback; refusal codes that distinguish whose
                    capability is missing; a schema-resident non-reuse policy for error
                    codes (two codes have already been retired — `-32002`, `-32042`).
                    The 2026-07-28 revision is a BREAKING stateless redesign: it removes
                    `initialize`, `ping` and `logging/setLevel`, moves version and
                    capabilities into per-request `_meta`, and removes sessions entirely.
Similarity to Praxis: Fail-closed capability negotiation is the same principle.
Difference from Praxis: **MCP's refusal names only what is MISSING.** Praxis names what is
                        missing AND what is present, which is a strict superset.
Potentially adopt: principle — a written non-reuse policy for taxonomy members
Do NOT adopt:     the per-request `protocolVersion` + `clientCapabilities` envelope (Praxis
                  owns both ends of its port; MCP needs it because its two ends may be
                  different protocol eras); the dual-era probing machinery; `ToolAnnotations`
                  (explicitly untrusted hints — Praxis's side-effect class is a commitment);
                  `isError: bool` (cannot express `side_effect_uncertainty`; MCP's own
                  motivating stateful example is a database transaction)
Praxis gap exposed: three, listed in §6.2
Needs Phase 6V validation? YES
Priority: HIGH
```

### OpenHands — ErrorClassification

```
Mechanism observed: A frozen, `extra="forbid"` error taxonomy of EIGHT kinds, each with a
                    `retryable` boolean, documented as "the only failure metadata that
                    crosses the event/API boundary".
                    Two of its kinds have no Praxis equivalent: `QUOTA` (separated from
                    RATE_LIMIT because the remedies differ — raise a limit vs. wait) and
                    `CONFIG` (the adapter or its credentials are misconfigured, as distinct
                    from the caller's request being wrong).
Significance:       This is the closest external analogue to the Phase 6B taxonomy, from a
                    project that kept its error boundary genuinely neutral.
Potentially adopt: a decision, not code — whether `quota` and `config` deserve kinds
Do NOT adopt:     `user_action: none|retry|settings` — a UI concern in a boundary record
Priority: HIGH — cheap to check against the frozen design, and exactly what 6V-0 exists for
```

---

## 5. A5 — Observability, and A6 — Extension lifecycle

### OpenTelemetry GenAI semantic conventions

```
Mechanism observed: `gen_ai.*` attributes under foundation governance. The namespace is
                    `Development` status, has MOVED to a separate repository, and has
                    already renamed `gen_ai.system` to `gen_ai.provider.name`. The GenAI
                    registry for `error.type` contains exactly one value: `_OTHER`.
                    The recommended production privacy pattern is to store content
                    externally and record references on spans. Capture hooks "SHOULD be
                    invoked regardless of the span sampling decision". `gen_ai.conversation.id`
                    carries an explicit do-not-synthesize rule.
Significance:       **The standard does not solve what Praxis's twelve-kind taxonomy solves,
                    and does not claim to** — it says instrumentations should document the
                    error lists they report. Praxis's twelve kinds ARE such a list.
Potentially adopt: principle — map outward on demand; do not freeze `gen_ai.*` names as an
                  internal contract; per-field sensitivity annotations; `providerMetadata`
                  should default toward references rather than inline provider payloads
Do NOT adopt:     making OpenTelemetry a dependency; building a tracing stack
Praxis gap exposed: no stated policy on whether Praxis ever generates a `traceId`
Priority: MEDIUM
```

### VS Code and Home Assistant — extension lifecycle

**Both findings here are FUTURE-SCOPED.** They are relevant only to a Skill or
Plugin ecosystem design that does not exist and is not in scope.

```
Mechanism observed: Both ecosystems converge on one property — capability must be
                    enumerable WITHOUT executing the plugin. VS Code uses a static
                    `contributes` declaration and cannot accept `*` as an engine range;
                    Home Assistant validates `manifest.json` at startup.
                    The most transferable single mechanism found in the entire scan is
                    Home Assistant's TWO-TIER dependency model: `dependencies` (hard — a
                    load failure is fatal) versus `after_dependencies` (soft — load order
                    and requirement availability only). And Home Assistant's
                    `iot_class: assumed_state` is a manifest-level declaration of "we
                    cannot know" — the closest A6 analogue to `effectStatus: unknown`.
Potentially adopt: principle — two-tier dependencies; an explicit "unknown" declaration
Needs Phase 6V validation? NO — out of scope for 6V
Priority: LOW (FUTURE)
```

---

## 6. Answers to the brief's section 24

### 6.1 Which Praxis mechanisms are already common engineering practice?

| Praxis mechanism                                      | Mature external equivalent                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Event ledger, append-first, corrections as new events | Temporal event history; classical event sourcing                                 |
| Projection, snapshot, catch-up versus rebuild         | CQRS projector types with checkpoint tables and snapshot-equivalence tests       |
| `operationId` and no-retry-until-verified             | Restate's journaled `ctx.run()`; idempotency-key practice stated almost verbatim |
| Replay and counterfactual replay                      | Temporal deterministic replay                                                    |
| Reflection with no side effects and hard budgets      | 2026 safety-sidecar and budget-awareness literature                              |
| ReusableAsset evidence-gated promotion                | Six independent skill-evidence projects                                          |
| Provider-neutral observability                        | OpenTelemetry GenAI conventions                                                  |
| Context exposure recording                            | Reconstruction-coverage and PROV-AGENT practices                                 |

**Praxis should cite these, not claim novelty for them.** Where it differs is in
making the ledger the single source of truth for all of them at once.

### 6.2 Which mechanisms are similar but implemented differently?

1. **Ordering.** OpenHands' EventLog is a **tree** with an explicit causal parent;
   Praxis has a flat sequence plus an optional `links.causedBy`. The tree is a
   stronger structural guarantee. Praxis's `causedBy` is currently unenforced —
   nothing checks that it resolves or that it points backwards.
2. **Failure taxonomy.** OpenHands' eight kinds against Praxis's twelve.
   Praxis has `side_effect_uncertainty` and `cancellation`, which OpenHands does
   not; OpenHands has `quota` and `config`, which Praxis does not.
3. **Capability refusal.** MCP names what is missing; Praxis names what is
   missing **and** what is present. Praxis is strictly better here — but the
   record does not state whether it encodes _direction_, and "you lack X" and
   "I lack X" have different owners.
4. **Write-time authority.** No project examined has an authorization check at
   its append boundary. `EventLog.append(event)` takes no actor at all. Praxis's
   ACL on every store write has no external analogue found.

### 6.3 Which mechanisms appear relatively distinctive?

1. **Ledger-as-source-of-truth with derived projections.** No external project
   found inverts the relationship this way. LangGraph's checkpoints _are_ the
   state; Mem0's history table is a sidecar beside a mutable store.
2. **Refusing to assert causation.** `Residual.effect` fixed to `unknown`. No
   external system found refuses to attribute cause, and Graphiti's reported 70%
   false-retirement rate is the strongest available support for the choice.
3. **A Reflection controller with no write ports at all.** Letta's consolidation
   agent has direct write authority, with documented silent drift.
4. **`WriterContext` with declared-actor versus recording-writer separation.**
   No external analog found.

**`exposureInfluenced` has no external precedent found at all.** That is not
evidence it is wrong, and it is also not evidence it is doing anything. It is
necessarily a Phase 6V item.

### 6.4 Which mechanisms are currently over-engineered?

Stated with the caveat that this is inference, not measurement:

- **`links.causedBy` / `respondsTo` / `supersedes` / `derivedFrom` are four link
  fields with no stated resolution semantics.** OpenHands gets more from one
  explicit `parent_id`. Four unenforced fields are a surface without a guarantee.
- **The 8-role `WriterContext` enumeration** has no external analogue and no
  evidence of use. It may be exactly right; nothing has exercised it.
- **Speculative scope.** No external project carries this many subsystems.
  LangGraph — the closest in surface area — has exactly **two** layers. Praxis
  has roughly twelve named mechanisms. Each is individually motivated by a
  documented external failure, so this is not gratuitous, but the integration
  surface is the delivery risk.

### 6.5 Which components could be simplified using mature patterns?

- **Replay verification** — take Temporal's command-versus-observation comparison
  rather than asserting determinism.
- **Schema evolution** — take upcasting (pure, read-time, one step at a time)
  before the ledger has production data.
- **Ledger retention** — Temporal's bounded history with state carry-over is a
  mature template for a real ceiling Praxis has not addressed.
- **Identifier defaults** — OTel's "populate only when you have a real
  identifier" rule applied to `traceId`.

### 6.6 Which external dependencies should NOT be adopted?

**None is to be adopted, and that is the finding, not an omission.** The list of
explicit non-adoptions is long and specific: checkpoint-as-source-of-truth;
"replay is a resume"; Graphiti's automatic LLM contradiction invalidation and its
silent-invalidation failure mode; Mem0's hard DELETE and its LLM memory-editor;
Letta's last-writer-wins rewrite and any reflection agent with write authority;
content screening as a primary poisoning defence; a scalar provenance weight in
ranking; model self-judgment as the primary STOP criterion; MCP's per-request
capability envelope; `ToolAnnotations`; `isError: bool`; AutoGen's
`InterventionHandler`; replacing SQLite with an external versioned database; and
the flock-based append path.

**The default this scan recommends: borrow principles, not code.** No component
examined is materially better than the principle it demonstrates, and the
project's dependency graph is itself a frozen artifact.

### 6.7 Which architecture decisions need real 6V evidence before being retained?

Ranked by how much rests on them:

1. **Is replay actually deterministic?** This is the load-bearing claim of the
   whole design. Temporal must police clocks and RNG through its SDKs; LangGraph
   abandoned determinism across model calls entirely; no project asserts it for
   a model-calling step. Praxis asserts it. **6V-0 and 6V-2X are where this is
   tested.**
2. **Is Reflection's STOP actually binding?** The enforcement-gap literature's
   central failure is that detection is high and enforcement is treated as an
   advisory log. Budgets must be enforced at the tool-call boundary in
   deterministic code.
3. **Does the promotion gate resist poisoning and false promotion?**
   `exposureInfluenced` has no external precedent; the poisoning literature
   establishes that content screening fails and only write-time origin binding
   works, and Praxis's ACL gates _who writes_ rather than _where content came
   from_.
4. **`quota` and `config`.** Do they deserve kinds? 6V-0 answers this against a
   real provider at almost no cost.
5. **Valid-time.** Cheap now, a migration later.

---

## 7. Gaps this scan exposes in the frozen Phase 6B boundary

Recorded, **not acted on**. The brief permits runtime-core modification only for
a CRITICAL compatibility defect reported as an `RFC MISMATCH`; none of these is
CRITICAL, and all of them are Phase 6V questions rather than defects. They are
listed here because Phase 6V is where they get answered.

| #   | Gap                                                                                                                                                             | Test in 6V | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 1   | No `quota` / budget-exhaustion kind — budget exhaustion may be forced into `rate_limit`, producing a "retry later" remedy for a condition that will never clear | 6V-0       | HIGH     |
| 2   | No `config` / deployment-misconfiguration kind, distinct from `invalid_request`                                                                                 | 6V-0       | HIGH     |
| 3   | `unsupported_capability` does not state whether it encodes _direction_                                                                                          | 6V-0       | MEDIUM   |
| 4   | No reserved range and no non-reuse policy for the twelve kinds — MCP has already retired two codes and responded by writing such a policy into its schema       | 6V-0       | MEDIUM   |
| 5   | `providerMetadata`'s default posture is unstated, and the rule constrains field _names_ while a vendor _value_ can ride under an innocuous key                  | 6V-2X      | MEDIUM   |
| 6   | No stated policy on whether `traceId` is ever generated rather than propagated                                                                                  | 6V-0       | LOW      |
| 7   | The Mailbox has no named failure vocabulary                                                                                                                     | 6V-4       | LOW      |
| 8   | `links.causedBy` is unenforced — nothing checks resolution or direction                                                                                         | 6V-2       | MEDIUM   |

**One structural lesson worth carrying beyond this list.** OpenHands enforced
neutrality at its _error_ boundary and did not enforce it at its _observability_
boundary, and leaked vendor detail into the latter within about a year while
being a well-resourced project. Phase 6B's rule covers both boundaries. **A
single stated rule covering two boundaries needs two enforcement points, or one
will drift.** That is a counterexample showing the discipline is hard — not
evidence that this project's discipline holds.

---

## 8. What would falsify this scan

- A licence check finding that a project marked "permissive, reported" is not.
- Opening LangGraph's or Temporal's primary documentation and finding that the
  determinism or interrupt semantics described here are wrong — both drive the
  two highest-priority recommendations.
- A project implementing `Residual`-style pre-registered expectations with a
  fixed-unknown effect. The search for one returned nothing, and a hit would
  remove the "no external precedent" claim from two mechanisms at once.
- Evidence that `exposureInfluenced` is set to `false` reflexively in practice,
  which would make it decorative rather than protective.
