# CODEX Re-entry Audit

**Round:** 1 — re-entry / base-freeze preparation  
**Date:** 2026-09-18  
**Decision boundary:** preserve valid temporary-agent work; repair only evidence-backed drift; no broad rollback and no release action.

## Authoritative read

The main Codex agent personally read the following before modifying code:

- `Codex_Implementation_Bible_v1.0.docx` — complete extraction/read, 892 non-empty paragraphs; the author's local absolute path is intentionally omitted from the public record.
- `Codex_Phase3.5_Correction_Pack_v1.0.docx` — complete extraction/read, 507 paragraphs; the author's local absolute path is intentionally omitted from the public record.
- `docs/RFC/RFC-0001.md`.
- All ADRs in `docs/ADR/ADR-0001` through `ADR-0015`.
- `docs/PHASE-3.5-GATE.md`, `docs/PHASE-5-GATE.md`, `docs/PHASE-5.5-RECOVERY-GATE.md`.
- `docs/PHASE-6A-EPIC-007-CONFORMANCE.md`, `docs/PHASE-6B-GATE.md`, `docs/PHASE-6-FINAL-GATE.md`.
- `docs/eval/PHASE-6V-PLAN.md`, `docs/eval/PHASE-6V-EMPIRICAL-REPORT.md`, and the 6V reconciliation documents.
- `docs/incidents/INC-001-partial-bible-execution.md` and `docs/incidents/INC-001-bible-conformance-audit.md`.
- `docs/断点记录.md`, `docs/engineering/FAILURE-FAMILIES.md`, `docs/engineering/RFC-MISMATCH-RECONCILIATION.md`, and `docs/engineering/_INVENTORY-RAW.md`.
- `docs/eval/OSS-EVAL-COUNTEREVIDENCE-SCAN.md`, `CORPUS-MANIFEST.md`, `CORPUS-I-REGISTER.md`, `MATERIAL-REQUEST.md`, `COMPATIBILITY-SURFACE-MAP.md`, and `SCENARIO-COVERAGE-MATRIX.md`.
- `README.md`, the current test/CI configuration, and the Git history from the Phase 5 baseline to the re-entry point.

`CODEX RE-ENTRY READ COMPLETE` was emitted before implementation. Attached documents were treated as engineering evidence and constraints; the current re-entry request remained the execution authority.

## Git state at takeover

| Item                                | Evidence at takeover                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| Starting branch                     | `docs/phase6v-prep`                                                   |
| Starting HEAD                       | `c28936ca6110d7329eed53768a055bf84b843582`                            |
| `origin/main`                       | `15f6e2f9e32f5b5a803330cab93a175a5d1d52f6`                            |
| `origin/docs/phase6v-prep`          | `6b7dcdc3380498a3e45e2a44a391b06b0f512097`                            |
| Divergence from `origin/main`       | local branch was 40 commits ahead, 0 behind                           |
| Divergence from remote phase branch | local branch was 3 commits ahead, 0 behind                            |
| Worktree                            | clean at the audit start                                              |
| Untracked files                     | none at the audit start                                               |
| Stash                               | none                                                                  |
| Tags                                | `phase4-checkpoint`, `inc-001-baseline`, `phase5-baseline-2026-09-17` |
| Remote mutation                     | none performed during re-entry                                        |

The work is now isolated on `codex/reentry-round1`. No force operation, history rewrite, remote push, or historical commit rewrite was performed.

## Temporary Claude / DeepSeek period

Classification is based on the Bible invariants, current tests, and the actual tree—not on authorship.

### KEEP

`1f0c6de`, `3392258`, `0225adb`, `25856c7`, `c6e762e`, `4f64c07`, `ff9f2f1`, `07f8e57`, `bb9cc82`, `0b3ed76`, `0d9035c`, `5d4a9b1`, `178841e`, `aa4068a`, `26ed05e`, `6b7dcdc`, `67c2275`.

These commits provide the adapter boundary, asset projection, Phase 6 gates, CI/gate hardening, the evaluator boundary, and the reconciliation evidence. They do not violate an identified frozen invariant. Their remaining limitations are recorded as evidence gaps rather than treated as proof of invalidity.

### REPAIR

`8c459e9` and `c28936c`.

`8c459e9` established the external evaluator and oracle boundary, but its initial asset arm was not end-to-end and its own documentation correctly exposed that limitation. `c28936c` collected the reconciliation layer but retained stale debt counts and stale “asset not wired” claims. The repair is additive and evidence-backed: asset lifecycle tests/wiring, machine registry audits, BP-064/BP-065 fixes, and current-status addenda.

The first re-entry repair commit is `316d26b` (`fix(verify): close BP-064 and BP-065`); the verifier-hardening follow-up also closes BP-066.

### REVERT

None identified. No temporary-period commit met the strict revert conditions: frozen-invariant violation, unrecoverable compatibility damage, or materially riskier repair path.

## Claims checked before repair

| Temporary report claim                                | Repository result                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Practice Freeze respected                             | **Confirmed for the 6V-prep documentation work;** evaluator wiring is the explicitly requested Round 1 scope.                                                                 |
| No runtime package changes in 6V-prep                 | **Confirmed** for the pre-reentry 6V documentation commits.                                                                                                                   |
| Node 22.13.0 CI was green                             | **Partially confirmed:** historical CI evidence exists, but it is not current-HEAD evidence and local Node 22.13.0 is unavailable.                                            |
| VF-01 is the dominant family                          | **Confirmed:** the verifier report lists missing/partial negative controls and the compatibility probe/evaluator review found BP-064/BP-065/BP-066.                           |
| ContextPlanner receives precomputed relevance factors | **Confirmed:** `packages/context/src/index.ts` ranks supplied factors; `evals/src/runner.ts` supplies scenario-scoped factors.                                                |
| ReusableAsset was not exercised end-to-end            | **Confirmed at takeover; repaired in this round:** `evals/test/assets.test.ts` now covers candidate → validated → human confirmation → active → later reuse/challenge/ignore. |
| V1/V2/V2X were unrun                                  | **Confirmed:** no real-model empirical run was found; scripted harness evidence is not promoted to field evidence.                                                            |
| GF01 unresolved                                       | **Confirmed:** the archive contains research-layer records and Production Card references, but no bounded, provenance-safe coherent chain was established.                    |
| BP-064/BP-065 were open                               | **Confirmed at takeover; fixed and regression-tested in `316d26b`.**                                                                                                          |
| Unknown verifier result was safely unadjudicated      | **Not confirmed at takeover; BP-066 found and fixed in this re-entry round with `evals/test/verifier-unknown.test.ts`.**                                                      |

## Security and preservation

The historical Honghu archive was read only for bounded source discovery. It was not copied into the repository, uploaded, or ingested into evaluation runs. Its provenance/licence/consent status remains unverified. No credential, token, private key, or provider secret was added to the tree.

## Re-entry conclusion

The temporary implementation period is **KEEP + REPAIR, not REVERT**. The branch is reversible to `316d26b`, `c28936c`, or the Phase 5 baseline tag. Base Freeze remains unauthorized until the evidence gates listed in `docs/release/BASE-FREEZE-READINESS.md` close.
