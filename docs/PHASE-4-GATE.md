# Phase 4 Gate — EPIC-007 Reusable Assets

**Status:** `PASS` within the declared local capability boundary
**Formal Alpha gate:** `GO`
**Controlling plan:** `Codex Implementation Bible v1.0`
**ADR:** `docs/ADR/ADR-0011-phase4-reusable-assets.md`

## Scope

This phase implements the Bible's EPIC-007 issues 060-066:

- versioned reusable-asset contracts for rule, skill, workflow, agent-policy,
  summary, and pattern;
- append-first candidate creation with derivation provenance;
- SQLite asset catalog persistence with atomic event/catalog writes and
  optimistic revision locking;
- explicit lifecycle transition validation;
- evidence, independent-episode, counterexample, validation, and human
  confirmation promotion policy;
- human challenge, disable, restore, and fork controls;
- provenance-aware projection, purge invalidation, and doctor integrity checks.

The Bible defines Phase 4 as Reusable Assets. The Correction Pack's conflicting
“Residual Engine” label is recorded as `RFC MISMATCH: PHASE4_LABEL_DRIFT`; it
does not change this scope.

## Acceptance review

| Issue | Acceptance condition                                                                                                                    | Evidence                                                                                                    | Result         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| 060   | Asset kind/status/version/revision/body/lineage contract is validated and versioned.                                                    | `packages/contracts/src/assets.ts`; `schemas/reusable-asset.v1.schema.json`; `tests/unit/assets.test.ts`    | `PASS` locally |
| 061   | Catalog writes are atomic with lifecycle events; stale revisions fail without losing the winner.                                        | `migrations/0010_reusable_assets.sql`; `packages/store/src/sqlite.ts`; CAS and multi-process scenario tests | `PASS` locally |
| 062   | Illegal lifecycle transitions are rejected; current state is rebuildable.                                                               | `packages/assets/src/index.ts`; `packages/state/src/index.ts`; asset unit/integration tests                 | `PASS` locally |
| 063   | Every managed asset has resolvable provenance; origin mismatches and catalog drift fail visibly.                                        | `packages/runtime/src/index.ts`; store doctor; provenance and tamper tests                                  | `PASS` locally |
| 064   | Promotion requires configurable evidence, independent episodes, validation, counterexample handling, and human confirmation for active. | `evaluateAssetPromotion`; promotion denial/active tests                                                     | `PASS` locally |
| 065   | Challenge/disable/restore are append-only human controls with explicit scopes and synchronized catalog state.                           | runtime façade; `asset.restore` ACL test; control integration test                                          | `PASS` locally |
| 066   | Fork creates a new id/revision and preserves independent fork lineage.                                                                  | `forkAsset`; `asset.fork` integration test                                                                  | `PASS` locally |

## Implementation evidence

### Contracts and domain

- `packages/contracts/src/assets.ts`
- `packages/contracts/src/authorization.ts`
- `packages/assets/src/index.ts`
- `packages/state/src/index.ts`

### Persistence and runtime boundary

- `migrations/0010_reusable_assets.sql`
- `packages/store/src/sqlite.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/src/index.ts` keeps the low-level store behind the
  composition root and exposes authorized `inspectAsset`/`listAssets` only.

### Tests and scenarios

- `tests/unit/assets.test.ts`
- `tests/unit/authorization.test.ts`
- `tests/integration/phase4-assets.test.ts`
- `scripts/phase4-assets.mjs`
- `scripts/phase4-assets-worker.mjs`
- `package.json` includes `phase4:scenario` in `pnpm verify`.

The targeted Phase 4/security test slice passes 33 tests across five test
files under local Node `v24.15.0`: authorization, asset policy, structured
expectation human-control, maintenance, and Phase 4 integration. The complete
repository-wide result is recorded after the verification command below.

The current-worktree `pnpm verify` also passes locally under Node
`v24.15.0`: 14 test files and 86/86 tests, plus format, lint, workspace and
dependency-direction boundaries, typecheck, build, schema parity, and the
Phase 1-4 scenario suite. GitHub Actions run `34978723319` then passed the
same gate on exact Node `22.13.0` under both Ubuntu and Windows; its first
Windows newline failure and `.gitattributes` correction are recorded in
`docs/断点记录.md` as `BP-040`.

## Security and permission review

The Phase 3.5 review identified the risk that a convenient low-level writer
could bypass the new asset policy. Phase 4 closes that path at several layers:

1. `asset.restore` is a dedicated scope, not a proposal fallback.
2. Managed lifecycle events require the complete asset snapshot and event/status
   match.
3. Promotion events require an accepted runtime review/decision; activation
   also requires explicit human confirmation.
4. Challenge/disable/restore/fork require a human-control source, human actor,
   OWNER authorization, and a non-empty reason.
5. Event and catalog writes are atomic and CAS-protected.
6. Doctor detects catalog snapshot drift, missing last event, status mismatch,
   missing evidence event/asset, evidence-origin mismatch, and broken fork
   parent.
7. Privacy purge removes affected catalog rows and leaves a content-free
   invalidation receipt, so stale catalog content is not retained after the
   source chain is purged.

The low-level store and `AssetEventWriter` remain trusted in-process
capabilities. They enforce structural event/catalog integrity and the frozen
writer scopes, but they are not an OS-level hostile-process boundary; all
application paths therefore enter through `RuntimeCompositionRoot`.

These are local capability and integrity controls. They do not claim OS-level
process isolation, enterprise identity, hostile-process resistance, or
hardware-level irreversible deletion.

## Complex-environment test

The scenario launches four independent workers against one SQLite database,
reopens the result, catches up the core projections, and runs doctor. Expected
behavior is one revision winner, explicit optimistic-lock conflicts for the
losers, no partial asset/event pair, and a passing doctor report. The command
is:

```text
pnpm phase4:scenario
```

The same scenario is included in `pnpm verify`.

## Three-way review

1. **Bible:** the implementation follows EPIC-007 and the package DAG; no
   automatic asset promotion or provider-specific evolution was added.
2. **The Final source materials:** lag, mismatch, provenance, reversibility,
   asynchronous positions, and human correction remain constraints. The code
   does not claim to solve the theory or erase subjectivity.
3. **`docs/断点记录.md`:** P35-01 and the Phase 4 breakpoints record planning
   staleness, permission-scope correction, low-level bypass hardening, CAS
   conflict handling, and catalog integrity drift.

## Formal gate result

**Phase 4 local implementation:** `PASS` within the bounded capability
boundary.
**Phase 4 Alpha/merge:** `GO`.

Gate D in `docs/PHASE-3.5-GATE.md` is closed by run `34978723319`: actual
`pnpm verify` evidence passed on both `ubuntu-latest` and `windows-latest` with
exact Node `22.13.0`. Local Node 24 results remain useful development evidence
but are not substituted for that runner evidence. Source synchronization to
the private GitHub repository remains a controlled handoff; it does not imply
public release.

## Rollback point

The Phase 4 work is kept in ordinary, reversible Git commits after
verification. The implementation checkpoint and the handoff merge preserve
the pre-sync history; the remote update uses a normal fast-forward after that
merge and never rewrites history. If any future implementation change
conflicts with this gate, stop, record the requested state, observed state,
impact, evidence, and decision in `docs/断点记录.md`, and report `RFC MISMATCH`
instead of silently widening the scope.
