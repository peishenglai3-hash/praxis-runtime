# Phase 6 Final Gate

**Date:** 2026-09-17
**Authority:** owner's Phase 6 finalization brief §L.
**Reached by:** `docs/phase6v-prep` at `6b7dcdc`, on top of `origin/main` (`15f6e2f`).
**Alpha release:** `NO-GO`. Nothing here is Alpha readiness, and this document
must not be quoted as it.

Every gate below is reported on its own. A gate this document cannot close is
named as open rather than folded into a summary, because the one thing Phase 6
has already produced more than once is a green reading taken from the wrong
place.

---

## The gates, independently

| Gate                         | State                         | Basis                                                              |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| Engineering                  | **CLOSED**                    | 11 stages, both platforms, pinned runtime, artifact-verified       |
| Node 22 CI                   | **PASS**                      | two uploaded artifacts, read rather than trusted                   |
| Adapter reality (6V-0)       | **OBSERVED, NOT CLOSED**      | nine scenarios; ran on the development runtime, not the pinned one |
| Low-risk behavioral (6V-1)   | **NOT RUN**                   | needs the evaluation harness and `MR-05`                           |
| Structured verifier (6V-2)   | **NOT RUN**                   | needs the harness; `MR-03` outstanding                             |
| Scaffold portability (6V-2X) | **NOT RUN**                   | needs two subjects and a second configuration                      |
| Golden Fixture 01            | **WAITING_FOR_AUTHOR_SOURCE** | `MR-01`, `MR-02` outstanding                                       |

### Engineering gate — CLOSED

`pnpm verify` is now `scripts/gate.mjs`, which runs eleven stages with
`shell: false` and writes a machine-readable result. Both CI jobs passed at
Node **22.13.0** with `dirty: false`, on the commit that contains this report
and the 6V-0 work — `6b7dcdc33804`:

| Platform | result | complete | notRun | matchesPin | wall clock |
| -------- | ------ | -------- | ------ | ---------- | ---------- |
| ubuntu   | PASS   | true     | `[]`   | true       | 119s       |
| windows  | PASS   | true     | `[]`   | true       | 243s       |

Read from the uploaded artifacts, not from the CI status line. That distinction
is not pedantry here — see BP-060.

**What this gate cost, and what it found.** Before this phase the repository had
**never run CI on the code it ships**. `origin/main` sat at an early commit; the
28 commits containing Phase 5, 5.5, 6A, 6B and 6V-PREP existed only locally, and
main's last green CI ran 86 tests. The first run on the pinned runtime failed on
**both** platforms and produced three real defects, all of the same shape —
correct on the development platform, wrong on the pinned one, with a passing
test as cover:

| Record | Defect                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| BP-061 | `assertOutsideWorkingTree` never refused on POSIX; the archive rule failed open on the write it exists to prevent |
| BP-062 | 5000ms was vitest's default, never a decision; and the whole codebase was single-platform evidence                |
| BP-063 | daemon smoke assumed the machine document is the last line of its stream                                          |

### Node 22 CI — PASS

Covered above; kept as a separate row because the brief lists it separately and
because it is the row that was silently absent for the whole project.

### Adapter reality gate (6V-0) — OBSERVED, NOT CLOSED

Nine scenarios against a live provider through the Phase 6B boundary; nine of
nine matched the expectation written before the call. Nothing observed fell
outside the twelve kinds, and `unknown_external_failure` was never used as a
bin. Full account: [`eval/6V-0-RESULTS.md`](eval/6V-0-RESULTS.md).

**Why it is not closed.** It ran on Node **24.15.0** with **`runtimeDirty: true`**.
§A3 of the brief forbids treating that as equivalent to the pinned runtime, and
BP-061 and BP-063 are both instances of what happens when it is. A
pinned-runtime, clean-tree repetition closes this gate; nothing else does.

Two further limitations, stated in the results document and repeated here
because a gate report is the place they are most likely to be lost: the quota
and config kinds the OSS scan flagged as absent were **not exercised**, so that
gap is untested rather than closed; and four of the nine failures were injected,
so they are evidence about this adapter and not about the provider.

### Low-risk behavioral gate (6V-1) — NOT RUN

Requires an evaluation harness that does not exist: run manifests are written by
hand in `tests/validation`, the metric definitions in
[`eval/PHASE-6V-PLAN.md`](eval/PHASE-6V-PLAN.md) §2 have no implementation, and
there is no scenario registry. Requires `MR-05` for the author's own recurring
tasks.

This gate is the one that can fail by **success**: its subject is
`FalseResidualRate`, `UnnecessaryReflectionRate` and unnecessary context
retrieval. "The tasks succeeded" is not a pass here.

### Structured verifier gate (6V-2) — NOT RUN

Requires the harness and three verifier classes. Its exit condition is
specifically that an external verifier **disagreed** and the disagreement was
recorded as a residual rather than smoothed away. `MR-03` — the author's own
unresolved failure — is outstanding.

### Scaffold portability (6V-2X) — NOT RUN

Requires one frozen scenario run under two subjects at `C0`. This is the
experiment that would close `RFC MISMATCH: SCAFFOLD_PORTABILITY_PENDING`, and
the owner's 2026-09-17 decision keeps that entry **open** until it runs.

The two claims are now named separately and must be reported separately:
**engineering portability** (issue 095's condition — event-type set, projection
versions, payload shapes) and **behavioral portability** (the brief's stronger
comparison). Neither implies the other.

### Golden Fixture 01 — WAITING_FOR_AUTHOR_SOURCE

The artefacts survive and the turn-level history does not. `MR-01` (the five
segments, of which 01-d — the rejection and its stated reason — is the single
most valuable missing item) and `MR-02` (the skip-the-card counterexample) are
outstanding.

Bible section 14 forbids synthesising it, and the brief repeats the
prohibition. There is no third outcome.

---

## Critical and High gaps

| Severity     | Item                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | None in the runtime.                                                                                                                    |
| **High**     | 6V-1, 6V-2 and 6V-2X have not run; the harness they need does not exist.                                                                |
| **High**     | 6V-0 is development-runtime evidence; a pinned-runtime repetition is owed.                                                              |
| **High**     | Golden Fixture 01 is blocked on author material that may never arrive.                                                                  |
| **High**     | The provider-neutrality rule had one enforcement point, over `packages/adapters` only. Now three; the two core packages had none.       |
| **Medium**   | `npm audit` reports 4 advisories (3 moderate, 1 low) on the default branch. Release Engineering, not Phase 6.                           |
| **Medium**   | The manifest schema declares no runtime field; node version is recorded in `notes`.                                                     |
| **Medium**   | `testTimeout: 30_000` is deliberately untuned. CI now reports real durations: Windows `test:integration` 34.3s across 13 files.         |
| **Future**   | The four unenforced link fields, the mailbox vocabulary, `traceId` synthesis policy and the `causedBy` gap recorded in the OSS scan §7. |

---

## Verdict

```
PHASE 6 IMPLEMENTATION & LIVE VALIDATION = INCOMPLETE
PHASE 6 FINAL                            = NOT REACHED
```

**The brief's fallback wording does not apply.** It reads:

> If GF01 alone remains unavailable, report: PHASE 6 IMPLEMENTATION & LIVE
> VALIDATION = PASS / PHASE 6 FINAL = BLOCKED — GF01 SOURCE REQUIRED

That sentence assumes the other gates are closed. **They are not.** Golden
Fixture 01 is not the only thing outstanding: 6V-1, 6V-2 and 6V-2X have not
been run, and 6V-0 has run but not on the runtime the gate names. Reporting
`IMPLEMENTATION & LIVE VALIDATION = PASS` would be true only in the sense that
"live validation" was never claimed — which is exactly the reading this project
has spent the phase eliminating.

Stated positively, and without rounding up:

- **What is closed:** the engineering gate, on both platforms, at the pinned
  runtime, with the evidence read from artifacts; and the four items the brief
  asked for before any experiment — the push, canonical CI, the structural
  closure of BP-060, and the three owner decisions recorded.
- **What is observed but not closed:** 6V-0.
- **What has not started:** 6V-1, 6V-2, 6V-2X, Golden Fixture 01.
- **Alpha release:** `NO-GO`, unchanged, and this document is not evidence
  towards it.

## What closes the remainder

In order, and none of it is a research question:

1. **6V-1/2/2X need an evaluation harness.** Run manifests are currently
   hand-built inside one validation file; the metrics have definitions and no
   implementation; there is no scenario registry. This is a subsystem, not a
   script, and where it lives is an architectural decision that has not been
   made — the same decision that kept the 6V-PREP manifest schema a _proposal_.
2. **6V-0 needs a repetition on Node 22.13.0 with a clean tree.** Cheap; it is
   the same nine scenarios.
3. **Golden Fixture 01 needs `MR-01` and `MR-02`.** No amount of work
   substitutes.
