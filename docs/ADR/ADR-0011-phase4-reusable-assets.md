# ADR-0011: Phase 4 provenance-aware reusable assets

**Status:** Accepted for Phase 4 Alpha after exact Node `22.13.0` CI verification
**Scope:** Bible EPIC-007, issues 060-066
**Gate:** `docs/PHASE-4-GATE.md`

## Context

Phase 3 can detect bounded residuals and propose reflection, but it must not
silently turn repetition or an AI proposal into a durable rule, skill,
workflow, or policy. Phase 4 therefore needs a versioned asset lifecycle with
source lineage, independent evidence, validation, human control, and a
rebuildable current view. The existing event ledger remains authoritative;
asset state is a derived catalog, not a replacement for history.

The Bible's Phase 4 name is **EPIC-007 Reusable Assets**. A label in the
uploaded Correction Pack calls this phase “Residual Engine”; that label is
retained as a documented `RFC MISMATCH: PHASE4_LABEL_DRIFT`, not used to
change the implementation scope.

## Decisions

### 1. Contract and package boundary

`packages/contracts/src/assets.ts` defines `AssetKind`, `AssetStatus`,
`ReusableAsset`, provenance references, promotion review/decision contracts,
and the `AssetEventWriter`/`AssetReader` ports. `packages/assets` contains
pure lifecycle and promotion policy. It does not import the store, runtime,
network, Agent, or provider adapters.

The dependency direction remains:

```text
contracts -> store/state/context/residual/reflection/assets/agents/adapters
         -> runtime -> apps
```

The runtime composition root is the only multi-package use-case boundary.

### 2. Asset model and event authority

The six supported kinds are `rule`, `skill`, `workflow`, `agent-policy`,
`summary`, and `pattern`. A reusable asset has an immutable identity plus
version, positive revision, status, JSON body, `derivedFrom` evidence,
optional `forkedFrom` lineage, and canonical creation/update timestamps.

Migration `0010_reusable_assets.sql` creates the current `assets` catalog.
Every managed lifecycle event carries the complete next asset snapshot and the
event sequence that produced it. The ledger event and catalog row are written
in one transaction. The catalog can therefore be rebuilt and doctor can detect
catalog drift, missing event lineage, event/status mismatch, missing
provenance, and broken fork references.

Legacy bare `asset.candidate` events remain readable for earlier Phase 2
fixtures. A candidate carrying the managed `asset` snapshot must use the
managed writer path; this compatibility exception does not weaken the new
lifecycle contract.

### 3. Lifecycle and promotion policy

The domain reducer allows only explicit lifecycle transitions. Promotion from
candidate to validated or active requires:

- configurable minimum evidence and independent episode counts (defaults are
  two evidence items and two independent episodes);
- evidence not counted as independent when it was exposure-influenced;
- a passing validation report with validator provenance;
- no unresolved severe counterexample; and
- explicit human confirmation for active status.

The policy returns a decision with reasons and counts. It does not write to the
ledger. `Phase4Runtime` verifies every referenced event/asset and provenance
origin, authorizes active promotion, creates the append-only lifecycle event,
and delegates the atomic compare-and-set write to the store.

No Agent role can directly promote an asset. A low-level `asset.validated` or
`asset.activate` event is rejected unless it contains the accepted runtime
review/decision shape; active promotion additionally requires human
confirmation. This is a structural use-case guard inside the local trusted
writer boundary, not a claim of OS-level isolation.

### 4. Revision and concurrency semantics

The asset catalog uses optimistic locking. A new asset must start at revision

1. An update must name the current revision and advance exactly once. The
   ledger event and catalog update share one SQLite transaction, so a stale
   worker cannot leave a half-written asset. An identical retry is idempotent by
   event identity/content; a different payload or stale revision is an explicit
   conflict.

### 5. Human controls and permission scope

The runtime exposes challenge, disable, restore, and fork as append-only
human-control operations. `asset.restore` has its own permission scope; it is
not collapsed into `asset.propose`. Controls require a human actor and a
human `OWNER` writer with the matching scope and a non-empty reason. Forking
creates a new asset id at revision 1 and records `forkedFrom`; the fork then
has independent revisions and history.

This explicit restore scope resolves the earlier
`RFC MISMATCH: ASSET_RESTORE_PERMISSION_SCOPE`, which was caused by the
initially over-broad `asset.* -> asset.propose` fallback.

### 6. Projection, purge, and doctor

`packages/state/src/index.ts` projects managed asset snapshots while retaining
compatibility with legacy asset verbs. Privacy purge removes catalog rows
whose source chain is purged and retains a content-free invalidation receipt.
`doctor()` checks the event/catalog/provenance relationship and fails closed on
catalog drift. These checks are diagnostic integrity evidence; they do not
replace event replay as the source of truth.

## Security and operational consequences

- Generic append is not a second lifecycle API for managed assets.
- Event immutability and no-delete triggers protect lifecycle history except
  inside the already authorized privacy purge path.
- JSON/Zod parsing is applied at contract boundaries; malformed review,
  validation, provenance, and catalog data fails explicitly.
- The local runtime uses capability authorization and a private composition
  boundary. It does not authenticate a person, isolate a hostile process, or
  promise hardware-level erasure.
- `VACUUM INTO` remains the pinned Node `22.13.0` backup mechanism. The
  `node:sqlite` API is experimental in that runtime; a later convenience API
  is not a reason to upgrade the canonical runtime.

## Non-goals

This ADR does not implement automatic skill evolution, neural routing, a world
model, provider-specific promotion, cloud multi-tenancy, or autonomous
execution of a promoted asset. It does not claim that synthetic fixtures are
author-owned production evidence.

## Acceptance traceability

| Bible issue                   | Local implementation / evidence                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| 060 contracts                 | `packages/contracts/src/assets.ts`, `schemas/reusable-asset.v1.schema.json`                      |
| 061 persistence and CAS       | `migrations/0010_reusable_assets.sql`, `packages/store/src/sqlite.ts`, Phase 4 integration tests |
| 062 lifecycle reducer         | `packages/assets/src/index.ts`, `tests/unit/assets.test.ts`                                      |
| 063 provenance validation     | `packages/runtime/src/index.ts`, provenance-origin and doctor tests                              |
| 064 promotion policy          | `packages/assets/src/index.ts`, promotion denial/activation tests                                |
| 065 challenge/disable/restore | runtime human-control façade, Phase 4 integration tests                                          |
| 066 fork                      | `forkAsset`, `asset.fork`, independent-lineage integration test                                  |

The implementation is locally testable and the formal Alpha gate is closed by
the exact Node `22.13.0` Ubuntu/Windows CI evidence recorded in
`docs/PHASE-3.5-GATE.md` and `docs/PHASE-4-GATE.md`.
