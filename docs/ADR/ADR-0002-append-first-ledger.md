# ADR 0002 Use An Append First Event Ledger

Status: Accepted

## Context

Later interpretations must not overwrite the historical record or masquerade as direct observation.

## Decision

Persist validated event envelopes as the factual ledger. Corrections, interpretations, and outcomes are new events with provenance and links. Privacy purge is an explicit, auditable exception and must be followed by projection rebuild.

## Consequences

History is auditable and replayable, but event volume, schema evolution, and purge semantics require explicit controls.
