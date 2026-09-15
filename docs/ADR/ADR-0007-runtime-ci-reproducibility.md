# ADR-0007: Runtime and CI reproducibility

**Status:** Accepted; exact Node 22.13.0 runner evidence verified in CI run `34978723319`

## Context

The Bible freezes Node.js `22.13.0`, SQLite WAL, and a lockfile-backed pnpm
installation as the merge baseline. Local Node 24 results are useful evidence,
but they are not evidence that the native `node:sqlite` surface behaves the
same way on the required Node 22 runner.

## Decision

- `.node-version` and `.nvmrc` both contain `22.13.0`.
- `package.json` requires Node `>=22.13.0 <23` and pnpm `11.19.0`.
- `pnpm-lock.yaml` is required to remain frozen in CI.
- Core CI runs the complete verification gate on Ubuntu and Windows with Node
  `22.13.0` and no provider secrets.
- Provider smoke is a separate manual workflow and is never a required pull
  request gate.

## Native SQLite mismatch boundary

Node documents the unflagged `node:sqlite` surface from `22.13.0`, but the
`DatabaseSync.backup()` convenience method was added later. Phase 3.5 therefore
uses SQLite `VACUUM INTO` for a consistent live snapshot, records this as an
explicit compatibility decision, and does not silently substitute a different
driver. If the pinned runner rejects this operation, the required response is
`RFC MISMATCH: SQLITE_DRIVER_COMPAT`, not an unreviewed dependency swap.

## Consequences

The repository has deterministic installation and OS coverage. CI run
`34978723319` produced green evidence on both required runners, closing the
Node `22.13.0` reproducibility condition for the current Alpha gate.
