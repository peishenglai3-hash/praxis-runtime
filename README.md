# Praxis Runtime

> **Engineering Preview candidate — not yet released.** The repository is
> public, but formal publication is still gated by the author's explicit
> `OPEN_SOURCE_GO` instruction. This candidate is reproducible engineering
> work, not a claim of production readiness or empirical usefulness.

Praxis is a local-first TypeScript runtime for auditable, long-term
human–AI collaboration. It preserves raw interaction events, reconstructs
derived state, plans bounded context, records residuals and reflections, and
turns only explicitly validated experience into contestable reusable assets.

The project is a second-generation fresh start after the public
[`codex-habit`](https://github.com/peishenglai3-hash/codex-habit) prototype.
The first generation is a future migration input, not a runtime dependency.

## Motivation and idealism

This project is not an attempt to make an AI increasingly resemble a person,
or to hand human judgment to a model. Its practical question is harder: when
people, models, prompts, skills, memory, tools, permissions and external
reality participate in a long practice, can the history remain inspectable?
Can delay, mismatch, failure and responsibility remain visible instead of
being smoothed into a fluent answer?

The idealism is deliberately operational. Experience should be checkable,
modifiable, challengeable and forkable. A failed collaboration should leave
replayable evidence and a possible next step. A useful rule may become a
versioned asset, but it must retain provenance, permission, dissent, disable,
restore, fork, export, purge and exit paths. Automation does not replace the
author's final judgment; it makes the points of judgment easier to inspect.

## Mission

```text
event history
  → deterministic state reconstruction
  → context planning
  → action / observation
  → bounded residual detection
  → bounded reflection
  → candidate reusable asset
  → validation
  → explicit human confirmation
  → active asset
```

This is not a mandatory loop for every task. Field, consequence, verification
strength and feedback latency determine which stages are appropriate.

## What Praxis is — and is not

It is:

- a local SQLite/WAL event ledger with append-first history;
- deterministic, rebuildable projections and replay;
- explainable context ranking over supplied relevance signals;
- bounded outcome, timing and rule residuals;
- bounded `STOP` / `CONTINUE` / `ESCALATE` reflection proposals;
- a versioned asset lifecycle: candidate → validation → human confirmation → active;
- a provider-neutral adapter boundary and an evaluation harness.

It is not AGI, a foundation-model trainer, a universal personality profile, a
cloud SaaS, a learned router, a World Model, an automatic skill-evolution
system, a provider marketplace, or an enterprise IAM boundary. A local process
with file access can modify a local database; the writer/ACL layer is a local
capability boundary, not OS isolation or authentication.

## Architecture

```text
contracts
   ↓
store ─→ state ─→ context
   ↓       ↓        ↓
runtime ─→ residual ─→ reflection
   ↓                         ↓
agents / adapters        assets
   ↓                         ↓
cli / daemon          human control surface
```

`runtime` is the composition boundary. `contracts` is the lowest layer.
Provider SDK types stay behind `adapters`; evaluation code stays outside the
runtime. The dependency direction is checked by `dependency-cruiser`.

## Current maturity

The recommended release class is **Engineering Preview**, not Research
Preview. The implementation and synthetic evaluation foundation are substantial
but current-branch real V1/V2/V2X task evidence, real asset benefit, and GF01
historical evidence remain incomplete. See:

- [`docs/release/PREVIEW-RELEASE-GATE.md`](./docs/release/PREVIEW-RELEASE-GATE.md)
- [`docs/release/KNOWN-LIMITATIONS.md`](./docs/release/KNOWN-LIMITATIONS.md)
- [`docs/eval/MINIMAL-EMPIRICAL-SMOKE.md`](./docs/eval/MINIMAL-EMPIRICAL-SMOKE.md)
- [`docs/eval/GF01-SOURCE-MAP.md`](./docs/eval/GF01-SOURCE-MAP.md)

The canonical runtime is exactly Node.js `22.13.0` with pnpm `11.19.0`.
`node:sqlite` is unflagged but still experimental in that Node release. The
backup path therefore remains `VACUUM INTO` plus manifest checksum, staged
restore, doctor and replay verification. Node 24 local results do not replace
the pinned CI evidence.

## Quick start

Use Node.js `22.13.0` and pnpm `11.19.0`:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
node apps/cli/dist/index.js init
node apps/cli/dist/index.js doctor
node apps/daemon/dist/index.js --once
```

The default local data directory is `.praxis/` in the working directory. It
contains `events.db`, writer-lock state and managed backups. It is local data,
not a public fixture; do not commit it. A strict optional
`praxis.config.json` may set `dataDir`, `migrationsDir`, `backupsDir`, actor and
writer metadata, legacy privacy rules, and the asset-promotion policy. Unknown
fields are rejected. Secrets do not belong in this file or in event payloads.

## Operator surface

After `pnpm build`, run the CLI as `node apps/cli/dist/index.js`:

```text
init
doctor [--json]
event append / event list
state show
rebuild
context plan
residual list
reflection run
asset list / inspect / contest / disable / restore / fork
history explain
backup create / list / restore
privacy purge <session-id> --dry-run
privacy purge <session-id> --confirm --plan-hash <sha256>
export
lock inspect / lock clear-stale
```

`--json` emits one machine document on stdout. Human confirmation is required
for asset activation and destructive privacy operations. `doctor` is a
diagnostic gate, not proof of OS-level security. Read
[`docs/HANDOFF.md`](./docs/HANDOFF.md) and the relevant ADR before extending
the surface.

## Verification and evaluation

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test
```

`pnpm verify` is the canonical eleven-stage gate. It must run on the exact
Node `22.13.0` runtime; the GitHub workflow runs it on Ubuntu and Windows.
Live provider validation is deliberately separate from the gate and requires
an operator-supplied environment credential. Without that credential, the
validation test says **skipped, not observed**.

The checked-in evaluation layer contains synthetic oracle, negative-control,
scenario and asset-lifecycle fixtures. Synthetic evidence is labelled as such
and must not be relabelled as real-world evidence. The four arms are intended
to remain structurally distinct: BASE, STATE, REFLECTION and FULL PRAXIS.

## Data, privacy and historical material

The runtime is local-first and does not upload data by itself. Backups,
SQLite WAL/SHM files, logs, raw histories, private chat and author-supplied
historical archives are not public release material. The historical GF01 source
is only mapped through bounded local discovery; it is not ingested, copied,
synthesised or uploaded. See [`docs/SOURCE-MANIFEST.md`](./docs/SOURCE-MANIFEST.md)
and [`docs/release/PUBLICATION-MANIFEST.md`](./docs/release/PUBLICATION-MANIFEST.md).

Privacy purge removes the permitted local payloads and records a minimal
tombstone. It cannot erase copies already sent to a remote, backup or synced
folder. Review the purge receipt and rebuild derived state afterward.

## Support and known limitations

The support vocabulary is evidence-based; `NOT TESTED` is not `SUPPORTED`.
See [`docs/release/SUPPORT-MATRIX.md`](./docs/release/SUPPORT-MATRIX.md) and
[`docs/release/KNOWN-LIMITATIONS.md`](./docs/release/KNOWN-LIMITATIONS.md).
In particular, macOS, arm64, provider-backed portability and real empirical
benefit remain limited or untested. Development-only dependency advisories are
listed in [`docs/release/DEPENDENCY-AUDIT.md`](./docs/release/DEPENDENCY-AUDIT.md).

## Contributing

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`docs/RFC/RFC-0001.md`](./docs/RFC/RFC-0001.md),
the relevant ADRs and the append-only [`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md).
Ordinary engineering changes do not require reading the author's full
intellectual source material. Changes to event semantics, core invariants,
asset lifecycle, reflection, writer/ACL or privacy semantics must cite the
controlling Bible/RFC/ADR and declare whether a frozen invariant changes.

Please report installation failures, false residuals, unnecessary reflection,
bad retrieval, asset overfitting, privacy concerns and provider mismatches.
Those are evidence, not merely user complaints.

## Source boundary, license and citation

The two `The Final` documents and related author materials are intellectual
provenance and review constraints, not executable code instructions and not
part of the public corpus. The repository-facing engineering contract is the
Bible-derived RFC and ADR set.

This source release is licensed under the [MIT License](./LICENSE). Citation
metadata is in [`CITATION.cff`](./CITATION.cff). There is no npm publication
contract in this preview; the workspace remains private to npm and the first
public artifact, when authorized, is the GitHub source release plus a separate
evaluation export.

## Publication status

The candidate branch may be pushed for CI and review. Do not merge it into
`main`, create a final tag, publish a GitHub Release, or upload to Hugging Face
until the author explicitly says `OPEN_SOURCE_GO`. The current publication
map is [`docs/release/PUBLICATION-MANIFEST.md`](./docs/release/PUBLICATION-MANIFEST.md).
