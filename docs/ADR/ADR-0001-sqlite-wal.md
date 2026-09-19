# ADR 0001 Use SQLite With WAL

Status: Accepted

## Context

The first Alpha needs a local-first durable store without an operational database service. It must tolerate concurrent readers and make write ordering observable.

## Decision

Use SQLite with WAL, foreign keys enabled, `synchronous=FULL`, and a configured busy timeout. All event writes go through one EventWriter. Use the Node.js built-in `node:sqlite` `DatabaseSync` API with a minimum Node.js version of `22.13.0`, the first 22.x line where the module is unflagged. The API remains experimental in that canonical runtime; unflagged does not mean stable.

The earlier draft named `better-sqlite3` as the initial driver. That driver was never part of a committed baseline; after the failed native install recorded in `docs/断点记录.md` (BP-001), this decision supersedes it for the Phase 1 implementation.

## Consequences

The design stays portable and inspectable. Write contention, backup behavior, and migration safety must be tested explicitly. A driver replacement requires evidence and a new decision record.
