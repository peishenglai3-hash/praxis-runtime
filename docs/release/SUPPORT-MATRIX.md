# Support Matrix

**Candidate:** `release/v0.1.0-preview-candidate`  
**Canonical runtime:** Node.js `22.13.0`, pnpm `11.19.0`  
**Status vocabulary:** `SUPPORTED / TESTED`, `PARTIALLY TESTED`, `EXPERIMENTAL`, `NOT TESTED`, `UNSUPPORTED`, `UNKNOWN`

This matrix records evidence, not aspiration. A local Node 24 result does not
close the canonical Node 22 row. The final candidate's exact-runtime evidence
is GitHub Actions run `35422995773`, whose machine-readable artifacts point to
commit `46a461a7bbd8297e003aae0b2976b41ce69b18fb`.

| Surface                         | Status               | Evidence / boundary                                                                                                     |
| ------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Windows x64 + Node 22.13.0      | `SUPPORTED / TESTED` | Exact `pnpm verify` passed in GitHub Actions run `35422995773`; artifact commit and runtime match.                      |
| Ubuntu/Linux x64 + Node 22.13.0 | `SUPPORTED / TESTED` | Exact `pnpm verify` passed in GitHub Actions run `35422995773`; artifact commit and runtime match.                      |
| Node 22.13.0                    | `SUPPORTED / TESTED` | `.node-version`, `.nvmrc`, `package.json` and CI pin the version.                                                       |
| Node 24.x                       | `UNSUPPORTED`        | Canonical runtime checker intentionally rejects `24.15.0`; incidental local tests are development evidence only.        |
| Windows PowerShell              | `PARTIALLY TESTED`   | Commands are documented and Windows CI runs the gate; every interactive PowerShell quoting/path variant is not covered. |
| Linux bash                      | `PARTIALLY TESTED`   | Ubuntu CI covers the gate; shell-specific operator workflows are not a compatibility promise.                           |
| macOS x64                       | `NOT TESTED`         | No pinned-runtime run in this round.                                                                                    |
| macOS arm64                     | `NOT TESTED`         | No pinned-runtime run in this round.                                                                                    |
| Linux arm64                     | `NOT TESTED`         | No pinned-runtime run in this round.                                                                                    |
| SQLite / `node:sqlite`          | `SUPPORTED / TESTED` | WAL, migrations, backup/restore and rebuild are covered on canonical CI; the API remains experimental in Node 22.13.0.  |
| CLI                             | `SUPPORTED / TESTED` | Build, command smoke and operator-surface integration tests.                                                            |
| daemon                          | `SUPPORTED / TESTED` | Fail-closed startup and one-shot smoke tests on the canonical gate.                                                     |
| Offline core runtime            | `SUPPORTED / TESTED` | Core gate has no provider credential or network dependency.                                                             |
| Provider adapters               | `EXPERIMENTAL`       | Provider-neutral contracts and conformance only; no provider is supported by the runtime release.                       |
| Live provider timeout/retry     | `EXPERIMENTAL`       | Boundary fixtures exist; current-branch real provider evidence is absent.                                               |
| CJK and whitespace paths        | `PARTIALLY TESTED`   | Windows compatibility probe and path tests exist; full platform matrix is not claimed.                                  |
| Historical corpus evaluation    | `UNKNOWN`            | GF01 source chain, licence and consent are not cleared; no corpus is ingested.                                          |
