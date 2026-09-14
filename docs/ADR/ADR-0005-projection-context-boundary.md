# ADR-0005 Projection and Context Boundary

## Decision

Projection reducers remain pure and receive immutable event records. The store owns SQLite handles and exposes only `ProjectionPersistence`; the state package owns catch-up, snapshot, and rebuild orchestration. Context planning receives candidate material and configuration, returns a deterministic plan plus exposure proposals, and does not append events. The runtime composition root records plan/exposure events.

Projection persistence accepts only monotonic, ledger-bounded cursors and uses compare-and-swap semantics for concurrent writers. Snapshots and agent cursors cannot advance beyond the authoritative event ledger. Plan and exposure events carry a complete plan/source chain and deterministic operation identities so retries are idempotent and partial bindings are rejected explicitly.

## Consequences

- Projection state can be deleted and rebuilt from the event ledger.
- A projection version mismatch triggers rebuild instead of silently applying a new reducer to old state.
- Transactional staging keeps the previous projection available when rebuild fails.
- Context selection can be audited through ranking factors, reasons, state cursor, and exposure events.
- Context exposure remains an inferred/derived materialization with explicit source origin; it is not silently reclassified as a direct observation.
- Residual detection remains outside the context package; later signals must cross an explicit runtime port.

## Rejected alternatives

- letting Context Planner write directly to SQLite, which would collapse planning and materialization;
- importing residual logic into context, which would create the prohibited dependency direction;
- treating snapshots or context caches as authoritative history.
