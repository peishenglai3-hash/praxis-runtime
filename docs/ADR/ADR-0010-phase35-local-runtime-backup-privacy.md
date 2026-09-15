# ADR-0010: Phase 3.5 local runtime, backup, and privacy boundaries

**Status:** Accepted for Phase 3.5

## Composition and ownership

`apps/cli` and `apps/daemon` are the composition roots. They choose data paths,
environment values, the SQLite store, actor, writer, clock, and mode. Packages
provide contracts and primitives; they do not read application environment or
silently create a production database. A database has one canonical writer
owner, protected by an atomic lock file containing PID, mode, start time, and
database path. A second embedded or daemon writer fails fast.

## Backup and restore

Live WAL databases are backed up with SQLite's consistent snapshot operation
(`VACUUM INTO` on the pinned Node baseline). Direct copying of the active
database or WAL sidecar is prohibited. A manifest records source hash, backup
hash, event cursor, projection versions, and coverage. Restore validates the
manifest checksum and SQLite integrity, stages the replacement, and requires a
safety copy before overwriting an existing destination; the caller then opens
the restored database and runs projection rebuild plus doctor.

## Privacy purge

`privacy purge --dry-run` only produces a closure plan. Confirmed session purge
requires a human OWNER with `history.purge`, records a receipt and purged sequence
ranges, clears projections/snapshots, preserves asset invalidation provenance,
and rebuilds projections. Managed backups covering the target are included by
default; `--preserve-managed-backups` is an explicit exception. The purge
transaction first records each backup's original path as `purge-pending`; file
deletion occurs after commit and is idempotently recoverable through
`privacy purge --finalize-pending`. Pending file cleanup remains visible to
doctor.

This is best-effort local purge. SQLite secure deletion and vacuum cannot promise
hardware-level irrecoverability on SSDs or external copies.

## Consequences

Purge intentionally creates audited sequence gaps. Projection replay accepts only
gaps backed by `purged_seq_ranges`; an unexplained gap still fails closed. The
`EventReader` and store are trusted low-level primitives; application callers
must use the composition-root methods so ACL and lifecycle checks are not
silently bypassed.
