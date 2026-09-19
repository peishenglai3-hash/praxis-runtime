# Dependency Audit

**Audit date:** 2026-09-19  
**Commands:** `pnpm audit --json`; GitHub Dependabot alert API; `pnpm why`

## Summary

GitHub reports four open alert records, representing three unique dependency
paths/advisories. There are no Critical or High alerts. The local audit exits
non-zero because the low and moderate development advisories are open; this is
not silently treated as a clean audit.

| Advisory                                 | Package/path                                                                             | Severity | Scope                  | Patched version | Decision                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | -------- | ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GHSA-82fw-gwwq-j7x9` / `CVE-2026-84373` | `vitest` direct dev dependency; one GitHub lockfile alert and one package manifest alert | Moderate | Development/test only  | `4.1.11`        | `ACCEPTED RISK WITH JUSTIFICATION`: not shipped as runtime source; upgrade is a separate dependency change and must be rerun through the full pinned gate. |
| `GHSA-82fw-gwwq-j7x9` / `CVE-2026-84373` | `@vitest/mocker` transitive dependency of Vitest                                         | Moderate | Development/test only  | `4.1.11`        | Same unique advisory as above; counted separately by Dependabot because the manifest paths differ.                                                         |
| `GHSA-g7r4-m6w7-qqqr`                    | `esbuild` reachable through `tsup`/`bundle-require` in the development toolchain         | Low      | Development/build only | `0.28.1`        | `ACCEPTED RISK WITH JUSTIFICATION`: no bundled `node_modules` or runtime server is released; schedule an upgrade before claiming a stronger release class. |

## Reachability and release decision

The affected packages are used by the build/test toolchain. The repository
source release does not include installed dependencies, and the runtime does
not import Vitest or esbuild at execution time. This does not make the alerts
irrelevant to contributors: they remain visible, open, and tracked. No
Critical/High exploitable advisory is carried into the candidate.

Dependency upgrades are not performed in this freeze round because they would
change the verified toolchain and require a separate compatibility run. The
candidate must not be described as vulnerability-free.
