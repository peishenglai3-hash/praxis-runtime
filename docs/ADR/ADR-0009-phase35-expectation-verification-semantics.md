# ADR-0009: Phase 3.5 expectation and verification semantics

**Status:** Accepted for Phase 3.5

## Decision

Outcome interpretation requires a structured `Expectation` baseline and an
explicit `VerificationResult`. A free-form model judgment cannot invent a
baseline after the fact. `validFrom`, `evaluateBy`, and `expiresAt` are distinct:

- before `validFrom`, the expectation cannot be judged violated;
- after `evaluateBy`, a timing concern may be recorded while outcome remains
  open;
- after `expiresAt`, the expectation is expired, not violated.

Verification policy is explicit (`state`, `tool`, `external`, or `human`) and
identifies its verifier where one is required. A timeout or unavailable external
verifier produces `unknown`, never an automatic `violated` result.

The lifecycle is append-only:
`expectation.created`, `expectation.updated`, `expectation.cancelled`,
`verification.requested`, `verification.completed`, and
`expectation.status.changed`. `expectations_current` is a rebuildable projection,
not a second source of truth.

## Evidence

ASYNC-01 through ASYNC-04 are replay regression fixtures. Synthetic fixtures are
clearly marked until the author supplies sanitized golden cases; they are not
presented as real external evidence.
