# Praxis Runtime v0.1.0 Engineering Preview

Praxis Runtime is a local-first TypeScript runtime for auditable, long-term
human–AI collaboration. This release freezes the first public engineering
preview of the event ledger, derived projections, bounded context planning,
expectation/residual/reflection path, contestable reusable-asset lifecycle,
CLI/daemon operator surface, backup/restore, privacy purge and synthetic
evaluation harness.

## Evidence

- GitHub Actions run `35422995773` passed the complete 11-stage `pnpm verify`
  gate on Ubuntu and Windows with exact Node.js `22.13.0`.
- The release procedure requires the tag to point to the verified merged
  `main` commit.
- Synthetic scenario, replay, negative-control, operator and asset-lifecycle
  tests are included in the repository.

## What this release does not claim

This is not production-ready software, a Research Preview, an AGI system, a
continuous-weight-learning system or a universal provider integration. Real
V1/V2/V2X behavioural evidence, real Asset benefit, the GF01 historical
fixture, macOS/ARM64 coverage and broad provider portability remain
limitations. The historical corpus and private author materials are not part
of this release.

## Security and privacy boundary

The runtime is local-first. Provider credentials are not stored in the event
ledger by design, and the public tree contains no private historical corpus or
usable credential. A local process with access to the SQLite file can modify
it; this is a documented boundary, not OS-level identity isolation. See
[`SECURITY.md`](../../SECURITY.md) and the [security/privacy audit](./SECURITY-PRIVACY-AUDIT.md).

## Compatibility

The canonical runtime is Node.js `22.13.0` with pnpm `11.19.0`. See the
[support matrix](./SUPPORT-MATRIX.md) and [known limitations](./KNOWN-LIMITATIONS.md)
for tested and untested surfaces.

## Data and migration

The preview uses local SQLite state and preserves migration/rebuild paths for
the supported schema. Back up local state before upgrades and use the staged
restore/doctor workflow documented by the CLI.

## Evaluation materials

Only synthetic/public evaluation definitions and schemas are intended for a
future Hugging Face export. No Hugging Face repository or private historical
material is uploaded by this release procedure.
