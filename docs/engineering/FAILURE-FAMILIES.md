# Failure Families

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §10 (`断点与 RFC Mismatch 整顿`).
**Input:** [`_INVENTORY-RAW.md`](_INVENTORY-RAW.md), a historical line-referenced
extraction of 64 entries, reconciled against the current 67-entry
[`../断点记录.md`](../%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md).
**Companion documents:** [`DEBT-RECONCILIATION.md`](DEBT-RECONCILIATION.md),
[`RFC-MISMATCH-RECONCILIATION.md`](RFC-MISMATCH-RECONCILIATION.md).

## 0. What this document is for, and the rule it follows

The brief's instruction is precise: the accumulated breakpoints must stop being
「互相孤立的小 Bug」 and become **failure families** — clusters that share a
_mechanism_, so that the next instance can be recognised as an instance rather
than discovered again from scratch.

**Family membership follows mechanism, not subsystem.** This is the whole
point, and it is why the families below do not line up with the phases. BP-061
is a path-handling defect in `apps/cli`; BP-063 is a stream-parsing defect in
`scripts/`; BP-062 is a configuration-placement defect in `vitest.config.mjs`.
Three subsystems, one mechanism: _a check that reported a result it had not
earned_. They are one family, and treating them as three separate bugs is what
allowed the third to be found after the first two were "fixed".

Two consequences, both deliberate:

- **A breakpoint may belong to more than one family.** BP-061 is both a
  portability defect and a false-green. That is not a classification failure.
  Each family answers a different question: _where does platform behaviour
  differ?_ versus _why did the check not notice?_ Forcing a partition would
  destroy exactly the information the families exist to hold.
- **Some breakpoints belong to no failure family, because they are not
  failures.** Ten of the 64 are status or gate records — the entry exists to
  record that a phase closed, not that anything went wrong. They are listed in
  §9. A family document that swallowed them would inflate every count in it.

## 1. Summary

| Family    | Name                                   | Members                                          | Severity of the mechanism                               |
| --------- | -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| **VF-01** | Verification False Green               | 16 recorded breakpoints, plus 3 harness findings | Critical — the defect is invisible by construction      |
| **PF-01** | Platform Portability                   | 11                                               | High                                                    |
| **MF-01** | Material Fidelity                      | 7                                                | High — silent data loss on a write that reports success |
| **BF-01** | Boundary and Capability                | 6                                                | High                                                    |
| **TF-01** | Temporal and Ordering                  | 5                                                | Medium                                                  |
| **CF-01** | Context and Projection                 | 6                                                | Medium                                                  |
| **RB-01** | Review Baseline                        | 4                                                | Medium — process, not code                              |
| **—**     | Not failures (status and gate records) | 10                                               | —                                                       |

The column does not sum to 67 and does not partition the space. On this
document's own memberships it covers **60 of the 67 breakpoints**, with 51–52
memberships in total; seven entries are in no family at all, listed in §11. The
first draft of this section claimed the column "sums to more than 64", which
holds on no reading — caught by the cross-check in §11 and corrected here rather
than in a footnote.

## Re-entry update — 2026-09-18

The family counts above are the reconciled registry view. Two pre-reentry
descriptions elsewhere in the Phase 6V documents are now historical: the
evaluator can call the asset lifecycle and the current ContextPlanner claim is
explicitly limited to ranking supplied signals. The machine-checkable registry
state, including BP-049/BP-064/BP-065/BP-066 closure, is in
[`DEBT-REGISTRY-AUDIT.md`](DEBT-REGISTRY-AUDIT.md).

---

## VF-01 — Verification False Green

**Definition.** A check reports PASS, and the PASS comes from a hidden
environmental condition, an incorrect test assumption, a mis-placed
configuration, platform-specific behaviour, a downstream pipeline's exit status,
letter case, or anything else unrelated to the property the check claims to
verify.

**Root mechanism.** The check and the property are _two different things_, and
nothing compares them. The check is written against a mental model of the
environment; when the environment differs from the model, the check keeps
reporting on the model. Detection is structurally impossible from inside the
run, because a false green and a true green produce identical output. Every case
in this project's history was found by a step separate from the run: a second
platform, a pinned runtime, a reviewer reading the schema, or a fault injected
on purpose.

**Members.**

| Breakpoint | The unearned PASS                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BP-003     | The worker-coverage assertion counted a shared event inside the per-worker set, so its own set definition produced `5/4` and the ledger was never at fault                                                                             |
| BP-006     | dependency-cruiser resolved workspace imports under CommonJS conditions and reported a valid ESM import as unresolvable                                                                                                                |
| BP-008     | ESLint declared globals for ESM only, so a legitimate `.cjs` config failed a quality gate before any runtime evidence existed                                                                                                          |
| BP-010     | The declared minimum Node came from the release that _added_ `node:sqlite`, not the one that dropped the flag — wrong in both `engines` and CI                                                                                         |
| BP-012     | Migration metadata stored no checksum, so an edited applied migration was undetectable; the fixture could not distinguish the conflict it claimed to cover                                                                             |
| BP-038     | The ACL change landed in code but not in `schemas/writer-context.v1.schema.json`; the schema-parity gate did not cover it                                                                                                              |
| BP-052     | Four async fixtures never ran, because the gate was marked "Closed structurally" for a property nothing tested                                                                                                                         |
| BP-053     | The recovery gate's `exact-runtime` proof was written against a run that did not contain the full suite                                                                                                                                |
| BP-059     | The `idempotencyKey` passthrough bypassed the write port                                                                                                                                                                               |
| **BP-060** | `pnpm verify` piped into `tail` reported `tail`'s exit status                                                                                                                                                                          |
| **BP-061** | `assertOutsideWorkingTree` had identical ternary branches, so on POSIX the first path segment was skipped and the guard **failed open**                                                                                                |
| **BP-062** | `testTimeout` was written at the Vite top level, silently ignored, and vitest's 5000 ms default stayed in force for the whole project                                                                                                  |
| **BP-063** | daemon-smoke assumed the machine document was the last line of its stream; on the pinned runtime a warning trailer follows it                                                                                                          |
| **BP-064** | `assert-cycle-detected.mjs` resolves dependency-cruiser against `process.cwd()`; it passes only because `runStage` happens to set `cwd: root`                                                                                          |
| **BP-065** | `assert-runtime-pins.mjs` parses `engines.node`'s upper bound with a three-component regex, so `<23` yields `undefined` and **the runtime check can never fail** — it printed `PASS` on Node 24.15.0, outside the pinned range, exit 0 |
| **BP-066** | the evaluator converted an independent verifier's `null` (“not adjudicated”) into `actual.status = "failed"`, manufacturing an outcome residual from absent evidence                                                                   |

**Found during Phase 6V, same mechanism.** Three defects in the new evaluation
harness, listed here rather than filed separately because their value is as
_instances_:

| Where                 | The unearned PASS                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evals/src/runner.ts` | `buildContextPlan({ mode: "reuse" })` requires a `previousPlan` and threw on every episode; an empty `catch {}` reset the exposure count to zero, so the STATE arm **silently ran as BASE** while every test was green |
| `evals/src/run.ts`    | `contextItemsExposed` was read from the post-call observation, which always held `0`, instead of from the context                                                                                                      |
| `evals/src/runner.ts` | `#observeWithReflection` carried a comment stating the error was "recorded, not swallowed" while recording nothing                                                                                                     |

And one in the reporting of this very phase: a command that ran the gate with
`| tail -30` and then read `$?` printed `GATE_EXIT=0` for a run the gate had
correctly marked FAIL. The gate was right; the shell reported its neighbour.

**Current mitigation.**

1. `scripts/gate.mjs` — no shell ever (`spawnSync`, `shell: false`, argv); a
   stage result is an exit code or `HARNESS`, never consulted from output; the
   semantic result is `test-results/gate-result.json`, written on every path
   including refusal. Eight regression cases including the BP-060 shape.
2. A boundary assertion that no gate stage names a credential-gated script.
3. **Negative controls.** `evals/test/schema.test.ts` (17 cases) checks that
   _specifically wrong_ documents are rejected, not merely that right ones pass.
   `evals/test/boundary.test.ts` includes a planted-import control proving the
   scanner can detect what it looks for. `evals/test/oracle.test.ts` drives all
   four arms with a scripted subject and asserts the empty-denominator case
   reports `unscored`.
4. The JSON-Schema validator **throws on any keyword it does not implement**,
   so it cannot under-validate silently. Written instead of adopting `ajv` for
   that reason.

**Remaining risk.** The negative controls cover the checks that exist. They do
not cover _the absence of a check_ — BP-038 and BP-052 are both "nobody wrote
it", and no amount of testing an existing check finds a missing one. The only
countermeasure in the record is the audit that reads the requirement text and
compares it against what exists, which is a human step and is RB-01's subject.

**Validation evidence.** CI run on `6b7dcdc33804` at Node 22.13.0, both
platforms, result read from the uploaded artifacts rather than the status line.
Local gate: 12 stages PASS. `evals/test`: 53 tests.

**Release implication.** `Blocks Alpha`. A project whose verification can
misreport is not safe to release, and this family has produced a defect in every
phase since Phase 5.

---

## PF-01 — Platform Portability

**Definition.** Behaviour is correct on the platform where it was written and
wrong on another, with no test able to fail on the original platform.

**Root mechanism.** The development platform is an unstated premise. It is
invisible because the developer's environment satisfies it, so the code _is_
correct — locally — and the defect only exists in the difference.

**Members.** BP-001 (native build chain), BP-005 (Windows `EPERM` on WAL
sidecar handles), BP-007 (`tsConfig.fileName` resolved against the wrong cwd),
BP-016 and BP-024 (pinned-runtime archive unobtainable), BP-031 (`purge:<uuid>`
uses a colon, illegal in Windows paths), BP-040 (CRLF normalisation), BP-044
(NUL bytes), **BP-061** (POSIX path walk), **BP-063** (stream order), **BP-064** (cwd-relative
tool resolution).

**Current mitigation.** CI matrix on Ubuntu and Windows at the pinned runtime;
`.gitattributes` for line endings; `paths.ts` with an injectable `PlatformPath`
so POSIX behaviour is provable _from Windows_; `assert-runtime-pins.mjs`
cross-checking three pin declarations.

**Remaining risk.** macOS and arm64 are **`NOT TESTED`** — not "supported", not
"probably fine". See [`../eval/COMPATIBILITY-SURFACE-MAP.md`](../eval/COMPATIBILITY-SURFACE-MAP.md).
The deeper risk is structural: BP-061 shows the matrix only helps if a test can
_fail_ on the other platform, and a Windows-only assertion cannot.

**Validation evidence.** The first pinned-runtime CI run failed on both
platforms and produced BP-061, BP-062 and BP-063 (§A of the finalization brief,
which is why that instruction was the most valuable in it).

**Release implication.** `Blocks Pre-Release Compatibility Audit`. The project
cannot state a supported-platform matrix it has not measured.

---

## MF-01 — Material Fidelity

**Definition.** A write or transformation reports success while the stored
material is less than what was supplied. The record is present, well-formed, and
not what happened.

**Root mechanism.** JavaScript's ordinary object semantics discard things the
author was not thinking about — `__proto__` as an own key, an impossible
calendar date silently normalised, a value the schema validator rebuilds into a
plain object. Nothing throws, because from the language's point of view nothing
went wrong.

**Why MF-01 and not the brief's `AF-xx / Asset Failure`.** The brief offers
Asset Failure as a placeholder and says 「分类名称以实际审计结果为准」 — names
follow the audit. The seven members are not one subsystem: BP-011 and BP-015 are
event-material fidelity in the store; BP-018 is a contract gap; BP-034 and
BP-043 are asset-lifecycle and migration integrity; BP-037 and BP-047 are
provenance and backup-restore. What they share is the _mechanism_ above, and
naming them "Asset Failure" would mislead a reader into looking at
`packages/assets`, where only two of the seven live.

**Members.** BP-011, BP-015, BP-018, BP-034, BP-037, BP-043, BP-047.

**Current mitigation.** `stableStringify` preserving own keys; the Zod contract
and `stableStringify` brought into agreement (BP-015); content hashes over the
raw envelope; migration checksums (BP-012); the assets-catalog/projection
agreement test added in Phase 6A.

**Remaining risk.** The mitigation is a set of specific fixes for specific
discards. There is no property test asserting `parse(serialise(x)) === x` across
the envelope, and BP-015 shows that fixing one discarding layer does not fix the
next one in the pipeline.

**Validation evidence.** BP-011 and BP-015 each record their own reproduction;
the Phase 6A projection/catalog agreement test is the current regression.

**Release implication.** `Blocks Alpha`. This family is the direct negation of
`INV-01` (append-first raw history) and `INV-02` (derived data never presented
as observed).

---

## BF-01 — Boundary and Capability

**Definition.** A capability, identity or scope boundary is reachable around
rather than through, so a constraint is bypassable without violating it.

**Root mechanism.** The boundary is enforced at one layer while the means to
cross it sits at another. BP-009 is the clearest: the SQLite handle was a public
property, so any consumer could run arbitrary SQL and bypass append-first,
validation, content hashing and provenance entirely — while passing every test,
because the tests used the API.

**Members.** BP-009 (public database handle), BP-023, BP-028, BP-036
(`asset.* → asset.propose` widened to restore), BP-042 (CI permissions),
BP-056 (public repository versus the frozen visibility decision — recorded by
the author as a confirmed design state, not a defect).

**Current mitigation.** `#database` private field with a read-only
`migrationVersion`; `WriterContext` scope ACLs; the dependency-cruiser rule
keeping adapters away from the store and runtime; the Phase 6V provider-neutrality
suites over the execution/error and observability boundaries.

**Remaining risk.** The ACL is enforced by `requiredScopeForEventType`, which maps
event types to scopes. BP-036 shows the mapping itself can be widened; nothing
checks that the mapping is _minimal_, only that it is applied.

**Validation evidence.** BP-009's thirteen tests; `tests/integration/adapter-neutrality.test.ts`.

**Release implication.** `Blocks Alpha` for BP-009's class; BP-056 is an author
decision and blocks nothing.

---

## TF-01 — Temporal and Ordering

**Definition.** Correct in isolation, wrong under interleaving, staleness or
ordering. The failure requires two things to happen in an order nobody wrote
down.

**Root mechanism.** A read and a write that must be atomic are separated by a
wait, and the code assumes the world did not change during the wait.

**Members.** BP-004 (migration snapshot read outside the write transaction),
BP-013 (`journal_mode = WAL` before the busy timeout), BP-014 (test-time
resolution to a stale `contracts/dist`), BP-026 (`actor.id` conflict semantics),
BP-049 (concurrent builds writing the same `dist`).

**Current mitigation.** Compare-and-swap on cursor advance; busy timeout moved
ahead of the first waiting PRAGMA; Vitest source aliases; the writer-ownership
lock with the Phase 3.5 concurrent-writer scenario.

**Remaining risk.** BP-049's source/dist ordering defect is closed for the
canonical verification path by the author's eleven-stage decision and its
regression. The concurrency work so far is C0–C2; C3 and C4 remain out of this
round by §19 and are not implied to be solved by the verify-order change.

**Validation evidence.** BP-013's 6 × 4-process repetition; `smoke:cli`'s
phase1-concurrency stage.

**Release implication.** The former BP-049 release block is closed. C3/C4
multi-process behaviour remains out of scope and must not be reported as
verified by this closure.

---

## CF-01 — Context and Projection

**Definition.** Derived state is presented, or selected, in a way that does not
match its provenance — or a projection lags behind the ledger it derives from.

**Root mechanism.** Two representations of the same thing, with nothing
comparing them. This is the same shape as the Phase 6A finding, where the
`assets` catalog table and the `assets` projection could disagree and each
looked correct alone.

**Members.** BP-020, BP-021, BP-022, BP-030, BP-033 (projection recovery gap,
purge/projection interplay, Node 24 exposure), BP-046 (`praxis init` and
`applyLegacyImport` write without catching up).

**Current mitigation.** The Phase 6A catalog/projection agreement test;
`catchUpCoreProjections` in the runtime; the projection rebuild discipline
(`INV-03`).

**Remaining risk.** `DEBT-RECONCILIATION.md` records BP-033 as a fixed defect
— its entry marks all four findings closed — where this document treated it as a
coverage gap. The reconciliation is right; the corrected reading is that the
_projection recovery gap_ it named was closed and the residual risk is the one
described below. The
Phase 6V harness added `recordContextPlan`, which puts exposure in the ledger —
but the harness's own context candidates supply their own relevance scores, so
**no run in this project has yet measured `ContextPlanner`'s judgement**, only
its sort order. That is recorded here because it is a finding about the
planner's testability, and it belongs to §13's architecture review.

**Validation evidence.** `tests/integration/phase6-asset-projection.test.ts`,
`tests/integration/phase2-projection-context.test.ts`.

**Release implication.** `Blocks Alpha` for the projection-agreement class.

---

## RB-01 — Review Baseline

**Definition.** An artifact is checked against a paraphrase, a summary or an
assumption rather than the text that controls it, so the gaps are not merely
unfixed — they are unlisted.

**Root mechanism.** The reviewer's model of the requirement and the requirement
are different objects. BP-017 states it directly: the implementation had been
verified against a derived RFC paraphrase rather than the Bible, and four
contract gaps only became visible on re-reading the source.

**Members.** BP-017 (four contract gaps found by re-reading the Bible),
**BP-050** (the family's general eruption — the construction never passed the
Bible; several documents unregistered, one critical defect, one failure), BP-055
(a scan pattern written into the document that performed the scan, so the
scanner could not scan itself), BP-058 (three same-source audit false positives:
`promoteAsset` authorization, `writerContextSchema` scope, `humanConfirmed`
default — one root cause, three reports).

**Why BP-058 is here and not in VF-01.** It is a false positive in an _audit_
rather than in a test, and its mechanism is a shared wrong premise between the
auditor and the artifact. That is RB-01's mechanism. It is also, honestly, close
to VF-01, and a reader who files it there is not wrong.

**Current mitigation.** The Bible is stated as controlling in `RFC-0001`; every
structural departure is a registered `RFC MISMATCH` with an owner (`INV-10`);
this document and its companions are the current reconciliation.

**Remaining risk.** **This is the family with the weakest mitigation.** It has
no test, no gate stage and no artifact that fails when the baseline is wrong. It
is also the family that produced the largest single defect in the project's
history. Its only countermeasure is a person reading the controlling document,
which is why §11 of the brief (RFC mismatch reconciliation) matters more than
its small entry count suggests.

**Validation evidence.** BP-050's own record; this reconciliation.

**Release implication.** `Blocks Release Engineering`. A project whose
requirements have never been fully enumerated cannot honestly declare a
supported feature set.

---

## 9. Entries that are not failures

Eleven entries are status or gate records: the entry exists to record that a phase
closed, a decision was taken, or a gate is pending — not that anything went
wrong. They are listed here so that no family count in this document is
inflated by them, and so that a reader looking for a defect in one of them stops
looking.

BP-019, BP-020, BP-021, BP-022, BP-025, BP-027, BP-029, BP-032, BP-035, BP-041,
P35-01.

Two of these carry a caveat worth stating: BP-020/021/022 are Phase 2 _gate_
records, and their content is a status, but the phase they close has since been
superseded — a reader should take the status from
[`DEBT-RECONCILIATION.md`](DEBT-RECONCILIATION.md) rather than from the entry.

---

## 10. Entries outside every family, and the cross-check that found them

### 10.1 Seven breakpoints belong to no family here

This document's families cover 57 of the 65 breakpoints. The other seven are
listed rather than assigned, because assigning them would mean inventing a
membership and §10's taxonomy is supposed to follow the audit, not tidy it.

| Breakpoint | Why it is not in a family                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BP-002** | The bundler rewrote the built-in specifier `node:sqlite` into `sqlite`, so the emitted bundle imported a module that does not exist. It is a _build-output_ defect and it genuinely resembles `PF-01` — but the platform was not the variable, the toolchain was, and stretching `PF-01` to cover it would blur what that family means |
| **BP-039** | Remote `main` and local `master` had no merge-base; a repository-history record rather than a code defect                                                                                                                                                                                                                              |
| **BP-045** | A 125-file review that found path truncation, exception-class collision and an append-only idempotency conflict — three mechanisms, no single one to file it under                                                                                                                                                                     |
| **BP-048** | Migration files were moved and lost addressability. Close to `MF-01` (the record is less than it was) but the loss is in the _filesystem_, not in a write that reported success                                                                                                                                                        |
| **BP-051** | CLI behaviour: `projection show` triggers a rebuild, `context plan --candidates` defaults wrongly, `--mode` is unvalidated. Three surface defects, no shared mechanism                                                                                                                                                                 |
| **BP-054** | The recovery gate placed Golden Fixture 01 after Phase 6's twelfth item. A gate-record correction, not a defect                                                                                                                                                                                                                        |
| **BP-057** | The Phase 6 delivery order deviated from the Bible and was registered as `RFC MISMATCH: PHASE6_DELIVERY_ORDER`. A process record, deliberately entered                                                                                                                                                                                 |

Naming them matters for a specific reason: an earlier draft of §1 claimed the
member column "sums to more than 64", which was false and made the coverage look
complete. The gap is now visible.

### 10.2 The cross-check, and what it corrected

`DEBT-RECONCILIATION.md` was written after this document and was instructed to
disagree where it disagreed. It found seven points. Each is recorded here rather
than quietly applied, because a correction that leaves no trace teaches nothing:

| #   | Finding                                                                      | Resolution                                                                                                                                           |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Seven entries are in no family and not in §9                                 | **Accepted** — §10.1 above                                                                                                                           |
| 2   | §9 said "ten" and listed eleven                                              | **Accepted** — the count was wrong; corrected to eleven                                                                                              |
| 3   | VF-01's summary said 12 while its table listed 13                            | **Accepted** — and this document then repeated the error while adding two more rows, so the count is now derived from the table rather than asserted |
| 4   | §1's "sums to more than 64" holds on no reading                              | **Accepted** — corrected in place, with the correction visible in §1 rather than hidden                                                              |
| 5   | §9 treats BP-021 and BP-022 as non-failures while both record real defects   | **Accepted** — noted at §9; the reconciliation read the bodies and this document read the headings                                                   |
| 6   | `CF-01` calls BP-033 a coverage gap where the entry marks all findings fixed | **Accepted** — corrected at `CF-01`                                                                                                                  |
| 7   | The reconciliation's own duty to flag that `_INVENTORY-RAW.md` is now stale  | **Accepted** — the inventory covers 64 entries and the record holds 65                                                                               |

**Six of the seven were errors in this document.** That is worth stating plainly:
the document that defines the project's failure taxonomy was itself wrong on
counts, on a claim about its own coverage, and on two classifications — and it
was written by the same reasoning process that produced the taxonomy. Nothing in
it was found by re-reading it. It was found by a second reader told to disagree.

Which is `RB-01` and `VF-01` again, in the document about `VF-01`.

## 11. What this document did not do

- **It did not re-read all 64 entries.** Family assignment is derived from the
  `root_mechanism` and `category` columns of `_INVENTORY-RAW.md`, which were
  themselves read from the entry bodies. Assignments should be read as
  well-founded rather than as individually verified.
- **It did not close anything.** No breakpoint's status changes because it was
  clustered. Statuses live in [`DEBT-RECONCILIATION.md`](DEBT-RECONCILIATION.md).
- **It was not internally consistent on its first pass.** See §10.2.
- **It did not delete or renumber anything.** The brief is explicit that the
  original BP history is preserved, and all 64 entries keep their numbers.
- **It did not name every possible family.** The six here are the ones the
  evidence supports. A seventh family would need a seventh mechanism, and
  inventing one to make the taxonomy look complete is the failure mode this
  project has spent the phase eliminating.
