# Contributing

**This project is an engineering preview candidate, not a stable release.**
Read the status note at the top of the [README](./README.md) first. Phases 5,
5.5, 6A and 6B are implemented; Phase 6V remains evidence-limited and the
release candidate is not yet authorized for publication. Contracts, schema and
the command-line surface can still change without notice.

## Before you write code

The repository is governed by a planning document — `Codex Implementation
Bible v1.0` — and a controlling engineering index, [`docs/RFC/RFC-0001.md`](./docs/RFC/RFC-0001.md).
The Bible is not vendored here; the RFC is the repository-facing summary that
binds.

Read, in this order:

1. [`README.md`](./README.md) — mission, boundaries, current phase status.
2. [`docs/RFC/RFC-0001.md`](./docs/RFC/RFC-0001.md) — invariants, dependency
   direction, delivery order, recorded `RFC MISMATCH` items.
3. [`docs/HANDOFF.md`](./docs/HANDOFF.md) — the shortest reliable entry point,
   including the working protocol for an external contributor.
4. [`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md) — the
   append-only failure and correction record. It is written in Chinese. Read it
   before proposing a fix: a surprising amount of what looks wrong here has a
   recorded reason.
5. The ADRs relevant to what you are touching, in [`docs/ADR/`](./docs/ADR/).

## The rules that are actually enforced

These are checked by tooling or by review, not aspirational:

- **Dependency direction.** `contracts` is the lowest layer. `runtime` is the
  only composition root that may combine multiple domain packages. `apps/cli`
  and `apps/daemon` call runtime use cases and do not orchestrate domain
  packages. Provider SDK types stay inside `adapters`. Violations are
  rejected by dependency-cruiser in `pnpm verify`.
- **Append-first.** Raw history is not overwritten. A correction is a new
  event. Privacy purge is the one explicit exception.
- **Derived data keeps provenance.** A projection, a residual and a candidate
  asset are never presented as observed fact, and automatic residual `effect`
  stays `unknown`.
- **The ledger is the source of truth.** `events.seq` is the authoritative
  replay cursor. All projection, agent and snapshot cursors use `seq`.
- **Migrations are forward-only and content-addressed.** A committed migration
  file's bytes are frozen; comments cannot be corrected in place. See
  `BP-048` in the breakpoint record.
- **Never silently compensate.** If the implementation and the Bible diverge,
  stop and record an `RFC MISMATCH` — requested state, observed state, impact,
  evidence, decision owner. Do not resolve it by editing the plan, by widening
  an invariant, or by writing a passing test around it. This rule exists
  because it was broken once; see
  [`docs/incidents/INC-001-partial-bible-execution.md`](./docs/incidents/INC-001-partial-bible-execution.md).

## Quality gate

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs eleven steps in a frozen order — runtime and version pins,
dependency integrity, lint and boundaries, typecheck and schema parity, the
unit, integration, replay and regression layers, build, then the CLI and daemon
smoke steps. A change is not done because the tests you wrote pass; it is done
when `pnpm verify` returns zero.

The canonical runtime is Node.js `22.13.0` and pnpm `11.19.0`. A local pass on
another Node version is useful development evidence and is **not** the gate
evidence; the pinned run happens in CI on Ubuntu and Windows.

Test layers and what belongs in each (Bible section 14):

| Layer          | Belongs there                                                       |
| -------------- | ------------------------------------------------------------------- |
| `unit/`        | Pure functions, contracts, reducers, ranking, detectors. No SQLite. |
| `integration/` | SQLite/WAL/migration, the event writer, rebuild, idempotency.       |
| `replay/`      | A fixed recorded stream replayed to a golden derived state.         |
| `regression/`  | Named past failures, so they stay fixed.                            |

A golden fixture is **not** updated to make a failing test pass. If a change
alters one, the change is explained in the commit message.

## Commits

Small and separately auditable. One concern per commit. Use the prefixes the
plan defines:

```
feat(contracts): feat(store): feat(state): feat(context): feat(residual):
feat(reflection): feat(assets): feat(migration): feat(cli): feat(adapters):
fix(...): test(...): ci(...): docs(...): chore(repo):
```

"No giant commit that implements the whole architecture." A database
migration, a contract-breaking change, or a change to promotion semantics also
requires an ADR or RFC update in the same pull request.

## What is likely to be declined

The delivery order is frozen: `EPIC-001 → … → EPIC-010`. Work that belongs to
a later phase is not accepted early even when it is small and obviously
correct — that is precisely how the project drifted the first time. The
specific things that are out of scope right now:

- Any provider adapter, provider SDK, or model integration. `packages/adapters`
  is deliberately an empty stub.
- Automatic asset evolution, new promotion strategies, skill generation, or
  new multi-agent roles.
- Release packaging, publishing, or "let's just tag a version" changes.

Issues, corrections, and `RFC MISMATCH` reports are welcome at any phase.

## Security

Do not report a vulnerability in a public issue. See
[`SECURITY.md`](./SECURITY.md).
