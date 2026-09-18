# Debt Registry Audit

**Date:** 2026-09-18  
**Checker:** `scripts/audit-registries.mjs`  
**Command:** `pnpm audit:registries`

## Result

**PASS — `registry audit PASS (breakpoints=67, RFC labels=24)`**

The check is also executed by `tests/regression/registry-audit.test.mjs`. It fails closed when any of the following occurs:

- a breakpoint ID is duplicated or missing from the declared total;
- a breakpoint status row is missing, duplicated, or inconsistent with the summary counts;
- a status row uses an impossible combination;
- an RFC mismatch label is duplicated or lacks a reconciliation row;
- the RFC reconciliation count disagrees with the rows it declares.

## Current breakpoint state

The current registry contains 67 unique IDs. The reconciled state is:

| Status              |  Count | Notes                                                                |
| ------------------- | -----: | -------------------------------------------------------------------- |
| `CLOSED`            |     64 | Includes BP-049, BP-064, BP-065, and BP-066 after this round's fixes |
| `ACTIVE`            |      0 | —                                                                    |
| `EVIDENCE-REQUIRED` |      1 | BP-037                                                               |
| `DEFERRED`          |      1 | BP-042                                                               |
| `WONTFIX`           |      1 | BP-056                                                               |
| **Total**           | **67** | Machine-checked                                                      |

BP-064 has a repair in place for both layers of the foreign-cwd failure: the
checker anchors its child process at the repository root and passes relative
fixture/config paths after the Windows Node 22.13.0 CI exposed the drive-path
edge case; the next canonical CI run is still required for final evidence.
BP-065 is closed with a shared semantic range parser, a negative Node 24 test,
and a positive Node 22 parser test; the positive test is not a substitute for
running the full project on Node 22.13.0. BP-066 is closed with an
unknown-verifier regression proving that `null` remains unadjudicated rather
than becoming a failure/residual/candidate.

## Current RFC registry state

The 24 RFC labels and 24 reconciliation rows are unique and aligned. The key re-entry outcomes are:

- `LEGACY_PATTERN_TO_CANDIDATE_ASSET`: **RESOLVED**, author decision Option B is implemented by the explicit human-run conversion path.
- `CLI_SURFACE_GAPS_VS_13`: **RESOLVED** in the current tree: rebuild/report paths exist and privacy purge accepts the Bible's positional scope while retaining `--session` as a compatibility alias; conflicting forms are rejected by an integration regression.
- `GOLDEN_FIXTURE_01_ABSENT`: **BLOCKING**, still waiting for bounded author-provided source material.
- `BP-049` is **CLOSED** by the author's 2026-09-18 canonical-order decision, recorded in `docs/断点记录.md`, `docs/ADR/ADR-0007-runtime-ci-reproducibility.md`, and `docs/engineering/BP-049-CANONICAL-VERIFY.md`; the machine check verifies the reconciled table and counts.

The checker validates registry structure. It does not decide author-owned semantics and cannot turn a stale or missing source decision into a PASS.
