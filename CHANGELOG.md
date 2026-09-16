# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it has releases.

## No versions have been released

There is no tagged release, no published package, and no supported version.
This project is **pre-alpha**. Everything below is development history recorded
so that the next contributor can reconstruct it, not a set of releases.

The delivery plan's version markers — `v0.1.0` Event substrate, `v0.2.0`
Replay + Context, `v0.3.0` Residual + Reflection, `v0.4.0` Reusable assets,
`v0.5.0-alpha` Legacy + real pilot — are milestones in the plan. They have
**not** been tagged in this repository.

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
- A Pre-alpha / Research Preview label at the top of the README.

## Known limitations at this checkpoint

These are recorded rather than omitted. Each is tracked in
[`docs/PHASE-5.5-RECOVERY-GATE.md`](./docs/PHASE-5.5-RECOVERY-GATE.md) and
[`docs/incidents/INC-001-bible-conformance-audit.md`](./docs/incidents/INC-001-bible-conformance-audit.md)
with a decision owner.

- **Phase 6 has not started.** There is no provider adapter of any kind;
  `packages/adapters` is an empty stub.
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
