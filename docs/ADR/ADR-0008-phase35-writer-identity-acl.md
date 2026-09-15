# ADR-0008: Phase 3.5 writer identity, ACL, and human control

**Status:** Accepted for Phase 3.5

## Context

An event's `actor` describes who acted in the event. It does not establish who
was authorized to register that event. The Phase 3 runtime had a caller-
declared actor but no separate auditable writer capability.

## Decision

Every append receives a validated `WriterContext` and persists it in
`events.writer_json`. The store performs authorization before schema validation,
sequence allocation, and transaction append. The required order is:

1. receive event draft and writer context;
2. validate writer and policy version;
3. map event type to a required capability scope;
4. authorize the writer and namespace;
5. validate the event contract;
6. allocate authoritative `seq` and perform the append.

The initial local capability roles are OWNER, OBSERVER, ANALYZER, VERIFIER,
COORDINATOR, ADAPTER, IMPORTER, and MIGRATION. ADAPTER is confined away from
`legacy.*`, IMPORTER is confined to `legacy.*`, and analysis roles cannot
activate assets. Irreversible human controls require a `human` writer with
role `OWNER`. Role names and policy version `1` are frozen in both the runtime
schema and the SQLite insert trigger.

The writer migration backfills existing rows as `system:migration` without
altering the event envelope or its content hash. Low-level raw database access
remains private to the store.

## Human controls

Inspect is read-only. Contest, disable, restore, and fork append a new control
event or create a new lineage; they do not overwrite the challenged history.
Export returns provenance-bearing records. Purge is an explicit, scoped,
confirmed operation and is recorded by a receipt; corrections remain new
events.

## Consequences

Writer provenance is now testable and replayable. The runtime root keeps the
low-level store private and exposes authorized read/export/maintenance
operations. This is still local capability ACL, not enterprise IAM or proof
that an operating-system user is authentic; the trusted identity provider and
human-control policy remain an explicit pre-Phase-4 owner decision.
