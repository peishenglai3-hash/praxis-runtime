# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it has releases.

## [0.1.0-engineering-preview] - 2026-09-19

This is the first public source release. It is an Engineering Preview, not a
Research Preview or production-ready runtime.

### Added

- Append-first SQLite/WAL event ledger, deterministic projections and replay.
- Bounded context planning, residual/reflection controls and human-gated asset
  lifecycle.
- CLI/daemon operator surface, backup/restore, privacy purge and diagnostics.
- Synthetic scenario, negative-control and asset-lifecycle evaluation fixtures.

### Changed

- Final engineering gate verified on Windows and Ubuntu with Node `22.13.0`.
- Public documentation states the evidence boundary and excludes private
  historical corpus from GitHub and Hugging Face publication.

### Known limitations

- Real V1/V2/V2X behavior, GF01 and real Asset benefit remain unvalidated.
- macOS/arm64 and live provider portability remain untested or experimental.
- Development-only dependency advisories remain disclosed in the release audit.

There is no npm publication contract for this preview.

## Development history before the first release

## [Unreleased]

### Phase 5 — audited Legacy migration, command line and diagnostics

- Legacy scanner, migration planner, nine anomaly classes, hashed read-only
  archive, and an import confined to a `IMPORTER` writer with no asset scope.
- Command line with a stable exit-code taxonomy, a versioned error document,
  and a `--json` mode in which stdout carries exactly one machine document.
- `praxis legacy import ... --report <path>` writes the migration report
  (Bible issue 085). The document is built by the runtime at one construction
  site, so a dry run and a committed run cannot describe a corpus differently.

### Phase 5.5 — INC-001 incident and recovery

- An incident was opened after it was established that Phase 5 had been
  implemented without the Bible being read in full, and against a constraint
  set that was missing one of the three author documents.
- A requirement-by-requirement conformance audit against the Bible found **no
  CRITICAL mismatch and no violated invariant**, so the classification was
  REPAIR rather than REVERT.
- The frozen test layers now exist: `tests/replay/` and `tests/regression/`.
- `pnpm verify` runs eleven steps in a frozen order, and the tests resolve
  workspace packages to source, which removes the dual-`dist` hazard recorded
  as `BP-049`.
- The four `ASYNC-01~04` fixtures the Phase 3.5 Correction Pack requires in
  `tests/replay/` are recorded streams with golden blocks (`BP-052`).

### Added

- `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and the GitHub issue and
  pull-request templates.
- An Engineering Preview release boundary and evidence-based limitations.

## Known limitations at this checkpoint

These are recorded rather than omitted. Each is tracked in
[`docs/PHASE-5.5-RECOVERY-GATE.md`](./docs/PHASE-5.5-RECOVERY-GATE.md) and
[`docs/incidents/INC-001-bible-conformance-audit.md`](./docs/incidents/INC-001-bible-conformance-audit.md)
with a decision owner.

- **Phase 6V is not empirically complete.** The provider-neutral adapter
  boundary and evaluation harness exist, but current-branch V1/V2/V2X real
  task evidence has not been collected.
- **Golden Fixture 01 is `WAITING_FOR_AUTHOR_SOURCE`.** It is authorial
  history and must not be synthesised.
- **`doctor` does not cover issue 081's full scope.** The `cursors` and
  `context` responsibilities have no check, and several Bible section 13.1
  responsibilities are reported rather than verified.
- **Bible section 5.4's event taxonomy is not met literally.** Several required
  event names are absent or named differently; registered as an `RFC MISMATCH`
  rather than silently compensated.
- **Three of Bible section 13.2's configuration knobs** remain package
  defaults rather than operator configuration.
- **`node:sqlite` is experimental** in the pinned Node.js `22.13.0`.
