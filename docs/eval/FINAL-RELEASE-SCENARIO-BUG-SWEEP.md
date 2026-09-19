# Final Release Scenario Bug Sweep

**Date:** 2026-09-19  
**Evidence class:** current repository tests plus bounded operator checks;
synthetic results are explicitly labelled.

| Scenario                           | Current result              | Evidence / remaining qualification                                                                      |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| FR-01 fresh tracked-only checkout  | `PENDING`                   | Must be run from `git archive` after the final candidate commit.                                        |
| FR-02 empty database               | `PASS (fixture)`            | Init/doctor and store integration tests create fresh databases.                                         |
| FR-03 existing database migration  | `PASS (fixture)`            | Migration and legacy/operator integration tests.                                                        |
| FR-04 backup/restore               | `PASS (fixture)`            | `VACUUM INTO` + manifest checksum + staged restore + doctor/rebuild tests.                              |
| FR-05 crash/restart                | `PASS (representative)`     | Crash-recovery script and replay suites; full OS kill matrix is not claimed.                            |
| FR-06 missing credential           | `PASS (boundary)`           | Provider validation skips loudly when key is absent; no credential is persisted.                        |
| FR-07 timeout/transient failure    | `PASS (synthetic boundary)` | Adapter taxonomy and no-blind-retry tests; no current live provider run.                                |
| FR-08 wrong config                 | `PASS (fixture)`            | Strict schema rejects unknown/malformed configuration.                                                  |
| FR-09 CJK/whitespace path          | `PARTIALLY TESTED`          | Windows path probe and tests; no full OS matrix.                                                        |
| FR-10 read-only/permission failure | `PASS (host probe)`         | Windows ACL probe and SQLite failure classification; portability limits remain.                         |
| FR-11 privacy purge                | `PASS (fixture)`            | Purge receipt, derived invalidation, doctor and rebuild integration tests.                              |
| FR-12 stale lock                   | `PASS (fixture)`            | Lock inspection/recovery and daemon/CLI smoke tests.                                                    |
| FR-13 stale asset                  | `PASS (fixture)`            | Human challenge/deactivate path and later non-injection tests.                                          |
| FR-14 corrupt derived state        | `PASS (fixture)`            | Raw event preservation and rebuild/replay tests.                                                        |
| FR-15 gate negative controls       | `PASS (negative controls)`  | Wrong Node, foreign cwd/PATH/config, format and registry controls.                                      |
| FR-16 missing historical source    | `PASS (policy)`             | GF01 remains waiting; no search outside the bounded author-approved source and no synthetic substitute. |

## Scenario conclusion

The representative regression surface is green under the available local
runtime and synthetic fixtures. FR-01 and the final exact-runtime run remain
release evidence tasks. No scenario result is a claim of real provider
usefulness or historical learning.

## Final candidate CI addendum

FR-01's tracked-only install/operator smoke passed locally, and GitHub Actions
run `35422995773` passed the canonical 11-stage gate on both Ubuntu and Windows
at commit `46a461a7bbd8297e003aae0b2976b41ce69b18fb`. The scenario table remains conservative because the
real-provider and historical-source rows are still not executed.
