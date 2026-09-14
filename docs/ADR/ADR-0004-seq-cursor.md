# ADR 0004 Use SQLite Sequence As Replay Cursor

Status: Accepted

## Context

Event identity and durable insertion order are different concerns. UUIDs do not provide the database ordering needed for replay and asynchronous cursors.

## Decision

Use the SQLite `events.seq` integer as the authoritative replay, projection, agent, and snapshot cursor. Event IDs remain globally identifying values only.

## Consequences

Replay and lag checks are deterministic within one ledger. Cross-ledger correlation must use IDs and links, not treat IDs as ordering values.
