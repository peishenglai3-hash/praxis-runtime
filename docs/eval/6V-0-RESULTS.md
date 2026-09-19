# 6V-0 — Adapter Reality: Results

**Status:** observed. Nine scenarios run against a live provider through the
Phase 6B boundary.
**Evidence grade:** **development evidence, not pinned-runtime evidence** — see
"Limits" below. This is the grade §A3 of the finalization brief says not to
promote.
**Authorisation:** the Phase 6 finalization brief §E, which is what `MR-07` was
waiting for.

## What was run

| Field          | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Provider label | `deepseek` (an opaque label: recorded, never branched on)                      |
| Model          | `deepseek-chat`                                                                |
| Adapter id     | `validation:deepseek`                                                          |
| Runtime commit | `aa4068a21d3b` at the time of the run                                          |
| `runtimeDirty` | **`true`** — the run happened with uncommitted work in the tree                |
| Node           | **`24.15.0`**, not the pinned `22.13.0`                                        |
| Concurrency    | `C0` (sequential baseline)                                                     |
| Records        | `test-results/6v0/*.json`, one `RunManifest` per scenario, plus `summary.json` |

## The nine scenarios

Expectations were written before the calls. The runner asserts the expectation
against the observed kind; a kind chosen because it was the closest fit would
have failed the assertion, not passed it.

| Run    | Scenario                         | Corpus     | Expected                      | Observed                      |
| ------ | -------------------------------- | ---------- | ----------------------------- | ----------------------------- |
| 6V0-01 | normal success                   | `corpus-p` | _(no error)_                  | none                          |
| 6V0-02 | timeout budget (`timeoutMs: 1`)  | `corpus-p` | `timeout`                     | `timeout`                     |
| 6V0-03 | caller cancellation              | `corpus-p` | `cancellation`                | `cancellation`                |
| 6V0-04 | unsupported capability           | `corpus-c` | `unsupported_capability`      | `unsupported_capability`      |
| 6V0-05 | provider rejects the request     | `corpus-p` | `invalid_request`             | `invalid_request`             |
| 6V0-06 | rejected credential              | `corpus-c` | `authentication_failure`      | `authentication_failure`      |
| 6V0-07 | rate limit (injected 429)        | `corpus-c` | `rate_limit`                  | `rate_limit`                  |
| 6V0-08 | malformed body (injected)        | `corpus-c` | `malformed_provider_response` | `malformed_provider_response` |
| 6V0-09 | `200` with no choices (injected) | `corpus-c` | `malformed_provider_response` | `malformed_provider_response` |

Nine of nine matched. Five were observed against the provider over the network
(01, 02, 03, 05, 06); four had their failure injected (04, 07, 08, 09) and are
labelled `corpus-c` for that reason.

## The primary question, answered narrowly

6V-0 asks whether a real provider's failure lands in the twelve kinds **or
whether something arrives that none of them describes**. On this evidence:

> **Nothing observed fell outside the taxonomy, and `unknown_external_failure`
> was not used as a bin.** Five real failures arrived and each landed in a named
> kind, with `timeout` and `cancellation` correctly distinguished from each
> other and from network faults.

That is a real result and it is also a **weak** one, for three reasons that
matter more than the nine green rows:

1. **The sample cannot find a gap it does not happen to hit.** Nine scenarios
   drawn from one provider on one day is not coverage of "everything a provider
   can do". Two kinds in particular were never exercised against reality:
   `transient_provider_failure` and `permanent_provider_failure`. The OSS scan
   separately found that OpenHands' frozen taxonomy carries `QUOTA` and `CONFIG`
   kinds that Praxis does not; **a quota exhaustion was not produced by these
   runs, so that gap is untested rather than closed.** Whether the twelve are
   sufficient is not answered by this run; whether they were sufficient for
   these nine is.
2. **The binary path is untested.** `unknown_external_failure` is reachable and
   was never reached. A kind that exists for genuinely unclassifiable failures
   and has never been produced is a kind whose behaviour is unknown.
3. **Two of the three failure-injection scenarios prove things about this
   adapter, not about the provider.** An injected 429 is evidence that the
   mapper handles a 429; it is not evidence that the provider sends one.

## The classification table is an inference, and the run tested it

`classifyHttpStatus` maps status codes to kinds by convention — 401 to
`authentication_failure`, 429 to `rate_limit`, and so on. Every entry is a claim
about what the provider means. The run exercised four of them against reality
(401, 400-or-404 for an unknown model, plus the two abort paths) and all four
held. The other statuses in the table remain inferences and are marked as such
in the source.

## Two findings that are not about the provider

- **The manifest schema does not declare a field for the runtime node version.**
  The first run wrote one anyway, and because the schema is
  `additionalProperties: false`, all nine records were **invalid** — while every
  test was green and the JSON looked correct. The records now conform, the node
  version is recorded in `notes`, and schema conformance is an assertion in the
  run rather than something a person is expected to check. Whether the schema
  should carry a runtime field is left as a question for the owner; this run did
  not widen a frozen schema to make its own output fit.
- **`capabilities()` declares `streaming`, `tools` and `structuredOutput` as
  false.** That is honesty about this adapter, not a statement about the
  provider. A production adapter would declare differently, and 6V-0 must not be
  read as evidence about what the provider supports.

## Where the adapter lives, and why

`tests/validation/validation-provider-adapter.ts`.

It cannot live in `packages/adapters`: that package is scanned by the
conformance suite for provider names and is allowed to depend on
`@praxis/contracts` alone, and a real adapter has to name a provider and speak
HTTP. The boundary's own claim — that provider detail is _scoped_ — is only
meaningful if the scoped thing sits outside it. Nothing in `packages/` or
`apps/` imports this file.

The run is gated on `PRAXIS_VALIDATION_PROVIDER_KEY` and is skipped without it,
loudly: a silently skipped validation run is indistinguishable from one that
passed, which is the failure this phase exists to find.

## Limits

Stated plainly so that this document cannot be quoted for more than it is.

- **This is not pinned-runtime evidence.** It ran on Node 24.15.0 while the
  pinned Alpha runtime is 22.13.0, and with `runtimeDirty: true`. §A3 of the
  brief forbids treating those as equivalent, and BP-061 and BP-063 are both
  instances of what happens when they are. A pinned-runtime repetition is
  required before 6V-0 is called closed on the runtime the gate names.
- **One provider, one model, one day.** No cross-provider claim follows.
- **Not a portability run.** That is `6V-2X`, and it needs two subjects.
- **Not a field validation.** No asset, residual, reflection or expectation was
  exercised; that is 6V-1 and 6V-2.
