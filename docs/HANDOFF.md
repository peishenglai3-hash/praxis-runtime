# Praxis Runtime — External Agent Handoff

**Handoff target:** GitHub repository
`https://github.com/peishenglai3-hash/praxis-runtime`

> **Visibility correction, 2026-09-16.** This document, the README, the phase
> gates and the INC-001 recovery all described this repository as **private**.
> It is not: `gh repo view` reports `visibility: PUBLIC`, `isPrivate: false`,
> created `2026-09-14T02:28:27Z`. It has been publicly readable since it
> existed, and everything on `origin/main` is public. The audit of that tree
> found no credential, no `.env`, no database file, no raw chat and no DOCX
> body, and none of those paths was ever committed; `docs/SOURCE-MANIFEST.md`
> does expose the owner's local absolute paths and personal directory names.
> No change was made — the visibility decision belongs to the owner. See
> `BP-056` in [`断点记录.md`](./%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md). Until
> that decision is made, treat every push as **publishing**.

**Owner:** Lai Peisheng

**License:** MIT

**Project generation:** second-generation fresh start after the public
[`codex-habit`](https://github.com/peishenglai3-hash/codex-habit) prototype.

This file is the shortest reliable entry point for Claude Code, DeepSeek,
OpenCode, Codex, or another engineering agent joining the project. It is a
repository handoff map, not a replacement for the controlling RFC or Bible.

## Current checkpoint

- **Phase 5.5 / INC-001 recovery is complete, and the P5-OPEN baseline repair
  followed.** The incident was opened after it was established that Phase 5 had
  been implemented without the Bible being
  read in full, and against a constraint set missing one of the three author
  documents. The recovery read every authoritative document, audited the
  repository against the Bible requirement by requirement, and repaired. Read
  [`incidents/INC-001-partial-bible-execution.md`](./incidents/INC-001-partial-bible-execution.md),
  [`incidents/INC-001-bible-conformance-audit.md`](./incidents/INC-001-bible-conformance-audit.md)
  and [`PHASE-5.5-RECOVERY-GATE.md`](./PHASE-5.5-RECOVERY-GATE.md) **before**
  any phase gate — a gate written before the recovery states things the
  recovery changed. No CRITICAL mismatch was found and no invariant was
  violated, so the classification was REPAIR, not REVERT. Golden Fixture 01 is
  `WAITING_FOR_AUTHOR_SOURCE` and must not be synthesised.
- Phase 5 / Bible `EPIC-008` and `EPIC-009` is implemented and locally verified
  within the declared local capability boundary: audited Legacy migration plus
  command-line, diagnostics and operational evidence. `pnpm verify` passes
  205/205 tests across 23 files, plus the Phase 1-5 scenarios, including a
  four-process concurrent import and a real-process command-line scenario. No
  exact Node `22.13.0` runner evidence exists for this checkpoint yet, so it is
  a local slice rather than a closed phase gate. The phase is `PARTIAL`: issue
  081's `cursors` and `context` doctor scope is uncovered, by owner decision.
  Entry points:
  `docs/PHASE-5-GATE.md`, `docs/ADR/ADR-0012-phase5-legacy-migration.md`,
  `docs/ADR/ADR-0013-phase5-cli-diagnostics.md`, and
  `docs/migration/LEGACY-FIELD-MAP.md`. The Phase 5 review round and the three
  boundary findings it escalated (`BP-047` fixed by owner decision, `BP-048`
  avoided, `BP-049` closed by the recovery) are set out in the gate document.
- Phase 4 / Bible `EPIC-007` Reusable Assets is implemented and verified within
  the declared local capability boundary.
- Gates A–D are `PASS` within that boundary. GitHub Actions run
  `34978723319` passed the exact Node.js `22.13.0` `pnpm verify` on both
  `ubuntu-latest` and `windows-latest`.
- Phase 4 local implementation is `PASS`; formal Alpha/merge is `GO`. This is
  not a claim of OS-level hostile-process isolation, enterprise IAM, or
  hardware-level irreversible deletion.
- Local verification was also run on Node 24 and passed, but Node 24 is not
  Node 22 evidence. `node:sqlite` remains experimental in Node `22.13.0`; the
  pinned backup path is `VACUUM INTO` plus manifest checksum, staged restore,
  and doctor/replay verification.
- Before changing code, run `git status --short --branch` and
  `git log --graph --decorate --oneline -15`. Treat the current tip as a
  reversible handoff checkpoint; never force-push or rewrite history.

## First read order

Read these files in order before implementation:

1. `README.md` — mission, boundaries, current phase status, and project
   motivation.
2. `docs/RFC/RFC-0001.md` — controlling engineering index, dependency DAG,
   phase order, invariants, and recorded `RFC MISMATCH` items.
3. `docs/PHASE-3.5-GATE.md` — reconciled Gates A–D and the exact remaining
   external evidence boundary.
4. `docs/PHASE-4-GATE.md` — EPIC-007 issue coverage, tests, security boundary,
   and Alpha/merge rule.
5. `docs/ADR/ADR-0008-phase35-writer-identity-acl.md`,
   `docs/ADR/ADR-0009-phase35-expectation-verification-semantics.md`,
   `docs/ADR/ADR-0010-phase35-local-runtime-backup-privacy.md`, and
   `docs/ADR/ADR-0011-phase4-reusable-assets.md` — accepted decisions for the
   current security, expectation, maintenance, backup, privacy, and asset
   boundaries.
6. `docs/PHASE-3-INPUTS.md` — reconciled input register; do not resurrect the
   superseded generic four-material request.
7. `docs/断点记录.md` — append-only failure, mismatch, correction, and
   rollback record, including `P35-01` and `BP-039`.
8. `docs/SOURCE-MANIFEST.md` — fingerprints and interpretation boundaries for
   the owner-supplied DOCX sources.

The Bible is the engineering planning baseline. The two The Final documents
are author-supplied intellectual provenance and review constraints. Neither
is executable code instruction, and neither should be paraphrased as a new
runtime guarantee without repository evidence.

## Repository-to-task map

| Repository path                                                     | Role                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/`                                           | Lowest-level event, provenance, authorization, expectation, asset, JSON, and port contracts.                  |
| `packages/store/src/sqlite.ts`                                      | SQLite WAL ledger, migrations, event writer/reader, managed maintenance, asset catalog, and integrity checks. |
| `packages/state/src/index.ts`                                       | Deterministic projection/replay and cursor-safe state reconstruction.                                         |
| `packages/context/src/index.ts`                                     | Explainable context ranking and exposure planning.                                                            |
| `packages/residual/src/index.ts`                                    | Bounded residual detection with explicit unknown/ordering semantics.                                          |
| `packages/reflection/src/index.ts`                                  | Bounded STOP/CONTINUE/ESCALATE proposals; no direct tool, agent, event, or asset promotion side effect.       |
| `packages/assets/src/index.ts`                                      | Versioned reusable-asset lifecycle and promotion policy.                                                      |
| `packages/runtime/src/index.ts`                                     | Composition/use-case boundary; authorization, human confirmation, and public runtime façade.                  |
| `packages/agents/src/index.ts` and `packages/adapters/src/index.ts` | Cursor/mailbox-facing ports and provider-independent adapter seams.                                           |
| `apps/cli/src/index.ts`                                             | CLI production composition root, maintenance, backup/restore, doctor, purge, and diagnostics.                 |
| `apps/daemon/src/index.ts`                                          | Fail-closed daemon composition root and one-shot smoke path.                                                  |
| `migrations/`                                                       | Forward-only SQLite migrations; `0010_reusable_assets.sql` is the Phase 4 catalog/lifecycle migration.        |
| `schemas/`                                                          | Versioned external JSON Schemas; run schema parity before changing contracts.                                 |
| `fixtures/phase35/` and `tests/`                                    | Synthetic async, unit, integration, regression, and boundary evidence.                                        |
| `scripts/`                                                          | Multi-process concurrency, crash, throughput, replay, residual, maintenance, and asset scenario gates.        |
| `legacy/`                                                           | Isolated first-generation migration inputs; do not silently import them into the core runtime.                |
| `labs/`                                                             | Experiments outside the core runtime; no automatic promotion into production packages.                        |

## Reproducible entry check

From the clone root:

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

The canonical package/runtime target is pnpm `11.19.0` and Node.js
`22.13.0`, pinned by `package.json`, `.node-version`, `.nvmrc`, and
`.github/workflows/ci.yml`. The CI workflow runs the same `pnpm verify` on
Ubuntu and Windows. A local Node 24 pass is useful development evidence only.

## Remote governance boundary

- The repository is **MIT-licensed and, as of 2026-09-16, verified PUBLIC** —
  see the visibility correction at the top of this document. Its Git history is
  protected by ordinary non-force synchronization and immutable commit
  ancestry. Treat `main` as owner-controlled by protocol rather than as a
  server-enforced protected branch, and treat every push as publishing.
- The repository Actions policy currently allows all actions. The checked-in
  core workflow requests only `contents: read`, uses no provider secrets, and
  has passed the exact Node 22 gate; workflow changes still require owner
  review because action tags are an external supply-chain boundary.
- An external model must work in an owner-created fork, review branch, or
  pull-request branch and return ordinary commits/patches for review. It must
  not push directly to `main`, change visibility, alter Actions permissions, or
  add credentials.

## Working protocol for an external model

1. Start with a read-only audit and state the exact issue/phase being worked.
2. Keep work in a short-lived branch or a clearly named local checkpoint;
   preserve the current tip and use ordinary commits as rollback points.
3. Do not overwrite raw events, historical breakpoints, accepted ADRs, or
   source-manifest fingerprints. Add corrections as new evidence.
4. Keep contracts/schema/migrations/tests synchronized. Run at least the
   narrow relevant tests and then `pnpm verify` before claiming a phase.
5. Any structural conflict with the Bible, RFC, or accepted ADR is an
   explicit `RFC MISMATCH` containing requested state, observed state, impact,
   evidence, and decision owner. Never silently compensate.
6. Do not grant permission merely because a field says `requiredPermission`;
   use the actual authorization and human-control boundary.
7. Do not promote assets, call providers, or broaden privacy/IAM claims from
   synthetic fixtures. Keep external evidence, author evidence, inference,
   and unknowns labelled separately.
8. Do not push, publish, change repository visibility, add secrets, or alter
   GitHub Actions permissions without explicit owner authorization. Normal
   non-force pushes are required for authorized synchronization.

## Bible roadmap after the current checkpoint

The remaining Bible delivery slices are:

- **Phase 5 — EPIC-008 / EPIC-009:** implemented. The remaining external gate
  is exact Node `22.13.0` Ubuntu/Windows CI evidence for this checkpoint, which
  is the same runner boundary Gate D closed for Phase 4. One scope gap is named
  in `docs/PHASE-5-GATE.md`: Bible section 13.2's context-ranking weights,
  reflection budgets and timing-residual thresholds remain package defaults.
- **Phase 6 — EPIC-010:** dummy-first adapters and provider isolation. This
  requires provider-independent contracts, deterministic fake adapters,
  timeout/error/budget fixtures, and proof that provider SDKs cannot enter the
  core dependency graph.
- **Release closure:** final gate reconciliation, controlled visibility/publication
  decision, and release documentation. The exact Node `22.13.0` CI evidence
  and Phase 4 Alpha gate are already closed; the MIT license is present, but
  public release is not implied by this handoff. (It reads "private" in the
  line above and in older gates; see the visibility correction at the top.)

No external model should label the project “complete” merely because Phase 4
code exists or local Node 24 verification passes.
