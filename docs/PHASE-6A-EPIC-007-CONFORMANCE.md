# Phase 6A — EPIC-007 Reusable Assets conformance

**Scope:** hardening and re-verification of the Bible's EPIC-007 surface.
**Bible reference:** section 15, EPIC-007, issues 060–066 plus the EPIC Gate.
**Baseline:** `phase5-baseline-2026-09-17` (`ca4d3d6`).
**Branch:** `phase6/epic-007-hardening`.
**Method:** Bible → requirement → implementation evidence → test evidence →
verdict. Read against the Bible text, not against the Phase 4 gate.

**This phase added no capability.** The owner's charter for Phase 6A, frozen on
2026-09-17, is hardening only: no automatic skill evolution, no institutional
promotion without human confirmation, no learned promotion policy, no new agent
roles, no provider-specific production adapters, no Phase 7+ features, no
release packaging. The delivery order itself is a registered deviation
(`RFC MISMATCH: PHASE6_DELIVERY_ORDER`, `BP-057`).

## Why this phase exists at all

EPIC-007 was already implemented and the Phase 4 gate says `PASS`. So the
question Phase 6A has to answer is not "does it work" but **"is the `PASS` the
kind of `PASS` that survives being re-derived from the tree"** — which is the
question INC-001 exists because nobody asked.

## 1. Conformance matrix

| Issue | Bible acceptance criterion                                                                                 | Implementation evidence                                                                                                                                                                                                                                                                                                        | Test evidence                                                                                                                                                                                                    | Verdict |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 060   | Asset contracts: kind/status/version/revision/body/derivedFrom/forkedFrom                                  | `packages/contracts/src/assets.ts` — `ReusableAsset` with all seven; Zod `.strict()`, `derivedFrom` `min(1)`, `updatedAt >= createdAt` refinement                                                                                                                                                                              | `tests/unit/assets.test.ts`; `schemas/reusable-asset.v1.schema.json` parity                                                                                                                                      | `PASS`  |
| 061   | Asset persistence: `assets` table; optimistic locking; revision conflict                                   | `migrations/0010_reusable_assets.sql` — table, `revision INTEGER CHECK (revision > 0)`, lifecycle integrity/immutability/no-delete triggers; `packages/store/src/sqlite.ts` `ASSET_REVISION_CONFLICT` with `expectedRevision`                                                                                                  | `tests/integration/phase4-assets.test.ts` "rejects low-level activation and preserves optimistic-lock conflicts"; `pnpm phase4:scenario` — one revision winner, three explicit conflicts                         | `PASS`  |
| 062   | Lifecycle reducer: draft→candidate→validated→active→challenged/deprecated; illegal transitions rejected    | `packages/assets/src/index.ts` `lifecycleTransitions` + `assertAssetTransition`; the **projection** re-checks via `assertProjectedAssetTransition` in `packages/state/src/index.ts`                                                                                                                                            | `tests/unit/assets.test.ts` "enforces lifecycle transitions and revision increments" — `validated -> candidate` and `validated -> validated` both throw                                                          | `PASS`  |
| 063   | Provenance validation: `derivedFrom` must resolve; no provenance means no `active`                         | `assertAssetEvidenceRefs` resolves **both** `eventId` (against the ledger) and `assetId` (against the catalog), and additionally requires the reference's `origin` to equal the ledger row's `provenance.origin`; the contract requires `derivedFrom` `min(1)` for every status, which is stricter than "not `active`"         | `tests/integration/phase4-assets.test.ts` "rejects provenance origin mismatches before creating a catalog row"                                                                                                   | `PASS`  |
| 064   | Promotion policy: cross-episode evidence, counterexample, validation, human confirmation, exposure lineage | `evaluateAssetPromotion` — `minimumIndependentEpisodes`, counterexample severity/resolved with unresolved-severe blocking, `validation.passed` plus validator provenance, `humanConfirmed` for `active`, `exposureInfluenced` excluded from the independent count and reported separately as `exposureInfluencedEvidenceCount` | `tests/unit/assets.test.ts` — exposure-only review yields `independentEpisodeCount: 0`; `tests/integration/phase4-assets.test.ts` "denies promotion without independent evidence or explicit human confirmation" | `PASS`  |
| 065   | Challenge/disable/restore: event-sourced user and system operations; projection in sync                    | `recordAssetControl` → `asset.contest` / `asset.disable` / `asset.restore`, each requiring `authorizeHumanControl` **and** `assertHumanActor` and a non-empty reason; the `assets` projection applies every transition                                                                                                         | `tests/integration/phase4-assets.test.ts` "uses human controls for challenge, restore, deprecation, and fork"; **`tests/integration/phase6-asset-projection.test.ts` (added by this phase)**                     | `PASS`  |
| 066   | Fork: new asset id; `forkedFrom` preserved; independent revision/history                                   | `forkAsset` — distinct id required, `revision: 1`, `forkedFrom` records the source's id/version/revision, `derivedFrom` gains the source asset reference                                                                                                                                                                       | `tests/unit/assets.test.ts` "keeps fork lineage independent from its source asset" — asserts the source is unchanged                                                                                             | `PASS`  |

**EPIC Gate**

| Gate condition                            | Evidence                                                                                                                                                                                                                                                                                                                                      | Verdict |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 任何 Agent 不能直接 promote               | Two independent guards. `authorizeHumanControl` (`packages/contracts/src/authorization.ts`) requires `kind === "human"` **and** `role === "OWNER"` **and** the scope, on the runtime use case; and `authorizeEventAppend` enforces the same human-OWNER rule for `asset.activate` on **every store write**, whatever scopes a writer declares | `PASS`  |
| 100% active asset has provenance          | The contract requires `derivedFrom` `min(1)` for every asset in every status, so an asset without provenance cannot exist, active or otherwise; `assertAssetEvidenceRefs` then requires each reference to resolve                                                                                                                             | `PASS`  |
| Revision conflict does not lose an update | `expectedRevision` compare-and-swap with `ASSET_REVISION_CONFLICT`; four-process scenario asserts one winner and three explicit conflicts                                                                                                                                                                                                     | `PASS`  |

**Risk-register mitigation** (Bible section 15, EPIC-007 row): 「assets 加
revision optimistic locking；证据记录 exposure lineage；Promotion 排除或降权
exposure-influenced evidence」 — all three are implemented. Optimistic locking
per issue 061; `exposureInfluenced` is a required boolean per episode;
promotion **excludes** exposure-influenced episodes from
`independentEpisodeCount` and reports them separately. The specific harm the
risk register names — 「证据被 context 暴露污染后仍计作独立证据」 — cannot
occur.

## 2. What this phase added

Nothing functional. Three tests, because one surface had no verification at
all:

`tests/integration/phase6-asset-projection.test.ts` compares the two
representations of asset state that EPIC-007 maintains:

- the **catalog table**, which the runtime reads to answer `inspectAsset`,
  decide a transition, and enforce optimistic locking;
- the **`assets` projection**, one of the five core projections, carrying
  Bible section 18 criterion 3's promise that 「所有核心 projection 可从 event
  ledger 重建」.

Every prior asset test asserted one side or the other. Both sides looked
correct on their own and nothing compared them — which is precisely the shape
of a gap that survives a `PASS`. The tests drive a full lifecycle, wipe the
projection, rebuild it from the ledger alone, and require agreement on status
and revision; a second case covers the restore edges, where a reducer that
understood only the forward path would drift.

**They pass.** The two representations already agreed. What was missing was the
check, and it now exists.

## 3. Suspicions raised and falsified

Recorded because a hardening pass that only reports what it confirmed is not
auditable. Three separate readings of this code produced a suspected defect,
and each was wrong. All three came from a **filtered** search — a range-limited
grep, or a grep of one function body — treated as evidence.

| #   | What I concluded                                                                                                | How it was falsified                                                                                                                                                                                     | Cost had it been reported                                               |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `promoteAsset` does not check human control, so asset activation is unguarded                                   | It calls `authorizeHumanControl` at `packages/runtime/src/index.ts:1468`. My grep used a line range that excluded 1468                                                                                   | A CRITICAL finding invented from whole cloth                            |
| 2   | `writerContextSchema` does not constrain scopes by role, so an agent could declare `asset.activate` and promote | Declaring a scope is not holding the capability. `authorizeEventAppend` refuses `asset.activate` unless the writer is a human OWNER, regardless of declared scopes — and it runs on every store write    | A CRITICAL finding that would have triggered a needless contract change |
| 3   | `humanConfirmed: true` is a caller-supplied boolean, so the recorded event asserts a fact nothing backs         | The same `authorizeEventAppend` rule makes the writer provably a human OWNER, so the recorded claim is backed by an authorization that actually ran. The boolean is redundant belt-and-braces, not a lie | A contract change to fleetingly improve a field that was already sound  |

The first two were caught by reading the guard function in full rather than
grepping for its call sites. The third by asking what the _neighbouring_ guard
already guaranteed. This is `BP-055`'s lesson recurring, and it is recorded as
`BP-058` with the countermeasure.

## 4. Result

**EPIC-007 conforms to its Bible acceptance criteria.** Seven issues, the EPIC
Gate and the risk-register mitigation all `PASS` on implementation and test
evidence, re-derived from the tree rather than inherited from the Phase 4 gate.

No CRITICAL finding. No HIGH finding. No defect was found; the phase's output
is the verification itself and the three tests that close the one surface which
had none.

**This is a code-completion result, not a behavioural validation.** Nothing
here demonstrates that the promotion mechanism is _right_ for real use — only
that it does what the Bible says, under test. Phase 6A therefore ends here,
with [`PHASE-6-GATE.md`](./PHASE-6-GATE.md) and a separate
[`PHASE-6-FIELD-VALIDATION-PLAN.md`](./PHASE-6-FIELD-VALIDATION-PLAN.md).
