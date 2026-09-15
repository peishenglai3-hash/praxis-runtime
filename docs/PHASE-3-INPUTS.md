# Phase 3 / Phase 4 Human Input Register — Reconciled

This file retains the original pre-Phase-4 input register for auditability.
The original table described decisions that had not yet been frozen. The
Phase 3.5 Correction Pack, the Implementation Bible, and the owner's explicit
continuation instruction now reconcile those items into a bounded local
capability contract. They are not a reason to repeatedly request the same four
generic material packages.

The labels below distinguish implementation decisions from external evidence:

- `FROZEN LOCAL`: decided and implemented for the local runtime boundary;
- `FROZEN STRUCTURAL`: the contract is implemented, while production evidence
  is intentionally outside this local candidate;
- `EXTERNAL EVIDENCE PENDING`: an actual runner or real-world artifact is still
  required for the Alpha claim;
- `OWNER POLICY IF EXPANDED`: only relevant if the project later expands beyond
  the current local scope.

## Reconciled register

| Input recorded before Phase 3.5       | Current reconciled status                                                                                                                             | Repository evidence                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Trusted writer identity               | `FROZEN LOCAL` as a validated local `WriterContext`; explicitly not OS/IAM identity proof                                                             | `packages/contracts/src/authorization.ts`, `docs/ADR/ADR-0008-phase35-writer-identity-acl.md`           |
| Role/scope/ACL matrix                 | `FROZEN LOCAL` for bounded roles, namespaces, explicit scopes, and `asset.restore`                                                                    | authorization contract and unit tests                                                                   |
| Human-control semantics               | `FROZEN LOCAL` for inspect/export, challenge, disable, restore, fork, purge, and OWNER confirmation                                                   | `packages/runtime/src/index.ts`, `docs/ADR/ADR-0008-phase35-writer-identity-acl.md`                     |
| External-verification policy          | `FROZEN STRUCTURAL` for typed verifier outcomes and explicit validation reports; no claim of external-provider authority                              | `packages/contracts/src/expectations.ts`, `docs/ADR/ADR-0009-phase35-expectation-verification-async.md` |
| Expectation time/resolution semantics | `FROZEN LOCAL` for ordered `validFrom`/`evaluateBy`/`expiresAt`, inclusive boundary, and explicit unknown/late handling                               | expectation contracts, replay tests, ASYNC fixtures                                                     |
| Author-owned golden cases             | `FROZEN STRUCTURAL`: ASYNC-01~04 are synthetic regression fixtures; production cases remain optional evidence, not a blocker for local implementation | `fixtures/phase35/ASYNC-01.json` through `ASYNC-04.json`                                                |
| Production assembly                   | `FROZEN LOCAL` for the local CLI/daemon composition root, one-writer lock, backup, restore, doctor, and purge flows                                   | `apps/cli`, `apps/daemon`, `docs/ADR/ADR-0010-phase35-local-runtime-backup-privacy.md`                  |
| Privacy and purge boundary            | `FROZEN LOCAL` as best-effort local purge with audit receipt, rebuild, and visible pending cleanup; hardware-level irrecoverability is not claimed    | ADR-0010 and maintenance tests                                                                          |
| Node 22 runner path                   | `EXTERNAL EVIDENCE PENDING`; exact GitHub Actions configuration exists, but no current-worktree source push was authorized                            | `.node-version`, `.nvmrc`, `.github/workflows/ci.yml`                                                   |

## What is allowed to proceed

The local implementation may proceed with the frozen contracts and synthetic
fixtures. A synthetic fixture demonstrates code behavior; it does not become
authorial production evidence or an external verification result. Phase 4
promotion remains gated by the runtime policy, provenance checks, validation,
and human confirmation described in `docs/ADR/ADR-0011-phase4-reusable-assets.md`.

The exact Node `22.13.0` runner remains a separate Alpha evidence gate. Local
Node `24.15.0` or bundled Node `24.19.0` results must not be relabelled as
Node 22 evidence.

## Boundary not to misread

`requiredPermission` on a Reflection action is descriptive metadata. It is
not an ACL check, human confirmation, or execution grant. Phase 3 records a
proposal only. Phase 4 uses an explicit promotion policy and a human OWNER
confirmation for active assets; it does not execute a reflection proposal
automatically.

The local `WriterContext` is a capability and provenance boundary. It does not
prove which human controls the operating system, prevent a hostile local
process from opening the database, or provide enterprise IAM. If those
properties become a project requirement, the exact identity/transport
interface and its acceptance evidence must be decided before that expansion.

## Closure sequence used for the current work

1. Re-read the Implementation Bible and treat it as the controlling
   engineering plan.
2. Use The Final documents only as design provenance and review constraints;
   do not convert their theory into unverified runtime claims.
3. Reconcile implementation, tests, ADRs, and `docs/断点记录.md` after every
   phase.
4. Run the local verification and the targeted multi-process scenario.
5. Keep Node `22.13.0` runner evidence separate from local Node 24 evidence.
6. Record structural conflicts as `RFC MISMATCH`; never silently compensate.

## Owner handoff format for future expansion

If a later phase expands the trust, transport, privacy, or production boundary,
new material should be labelled as one of:

1. direct author/operator decision;
2. external verification or artifact evidence;
3. implementation proposal;
4. unresolved dispute or unknown.

Only the minimum sanitized contract or fixture should enter the repository.
Original The Final documents, credentials, private conversations, and
unsanitized historical records remain outside the runtime database unless a
separate publication decision is made.
