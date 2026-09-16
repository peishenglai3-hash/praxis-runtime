# INC-001 — Partial-Bible Execution / Compound Specification Drift

**Incident:** INC-001
**Opened:** 2026-09-16
**Baseline at handover:** `542481b` (tag `inc-001-baseline`), branch `phase5/legacy-cli`
**Recovery branch:** `incident/inc-001-phase55-recovery`
**Recovery scope:** Phase 5.5 — IR-01 … IR-05, per the author's recovery prompt

---

## 1. What happened

The project was handed from its original executing model (Codex) to another
model because of a quota limit. During the takeover the following sequence
occurred:

```
the Bible was never read in full by the executing model
  ↓
sub-agents, extracted fragments and local summaries were used instead
  ↓
an incomplete internal model of the specification formed
  ↓
construction continued on that model
  ↓
local code began to diverge from the frozen specification
  ↓
later work was built on the already-diverged state
  ↓
compound drift
```

The consequence is the one the recovery prompt states: the code existing does
not mean it conforms; tests passing does not mean the phase is closed; and the
executing model's own self-assessment is not sufficient audit evidence.

## 2. Timeline

| Date/time         | Event                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| 2026-09-13        | `docs/SOURCE-MANIFEST.md` created; records **two** The Final documents        |
| 2026-09-14 11:59  | `The_Final_补充性扬弃Ⅱ` written — a third author document, in the same folder |
| 2026-09-15 ~21:00 | Phase 4 closes; handover to the second model                                  |
| 2026-09-15 23:04  | Phase 5 implementation begins (EPIC-008)                                      |
| 2026-09-15 23:41  | Phase 5 CLI (EPIC-009)                                                        |
| 2026-09-16 09:39  | Phase 5 "review round" and gate written                                       |
| 2026-09-16 09:58  | BP-047 fix                                                                    |
| 2026-09-16 ~11:00 | The author challenges the phase's Bible grounding                             |
| 2026-09-16 ~11:30 | The executing model reads the Bible in full for the first time                |
| 2026-09-16 ~12:00 | INC-001 opened; Phase 5.5 recovery begins                                     |

The third document existed on disk for roughly 35 hours before Phase 5 was
implemented and was never read. It is not redundant: it explicitly supersedes
the reading of the theory that the Phase 5 gate cited.

## 3. Root cause

Three causes, in order of weight. Only the first is a reading failure; the other
two are process failures that let it pass unnoticed.

1. **The RFC's paraphrase was treated as the Bible.** `docs/RFC/RFC-0001.md` is
   an index. Bible section 0 states that the Bible itself is "当前阶段交付
   Codex 的唯一工程规划基线". Implementation was driven from the index.
2. **The review brief inherited the unread understanding.** Three sub-agent
   audits were dispatched and each was competent, but each was asked to check
   the list they were given — and that list came from the same incomplete
   model. A reviewer cannot find what the brief does not know to ask for.
3. **The "three-way review" was one-directional.** The Phase 5 gate's theory
   section produced four answers, all confirming the implementation, with zero
   unmet constraints and no citation. That is the shape the third author
   document names as a theory that always wins.

The evidence for cause 2 is that reading the Bible in full immediately
surfaced four requirements **no** sub-agent audit had found (Golden Fixture 01,
the two missing test layers, `rebuild --projection`, and issue 085's report
path). The evidence for cause 3 is the gate text itself, retained in the
repository's history at commit `5dc1e55`.

## 4. What the audit found

Full matrix: [`INC-001-bible-conformance-audit.md`](./INC-001-bible-conformance-audit.md).

**No CRITICAL mismatch, and no Bible invariant (INV-01…INV-10) is violated.**
The drift is real but it is drift in _coverage, declared structure and naming_,
plus one invented event type and one control that cannot fail — not in the
ledger, provenance, authorization or privacy semantics. That distinction is why
this recovery is a REPAIR rather than a REVERT.

Severity roll-up: 0 CRITICAL, 6 HIGH, 9 MEDIUM, 6 LOW.

The HIGH findings:

| #   | Finding                                                                       | Bible                |
| --- | ----------------------------------------------------------------------------- | -------------------- |
| 1   | `tests/replay/` did not exist                                                 | §14, §15 026         |
| 2   | No runaway regression                                                         | §15 055              |
| 3   | ASYNC-01~04 not in the frozen replay layer                                    | Correction Pack §3.7 |
| 4   | 「旧 patterns → candidate asset」 not implemented                             | §12, §15 073         |
| 5   | Doctor covered roughly a third of §13.1's named responsibilities              | §13.1, §15 081       |
| 6   | Issue 082–086 marked `PASS` while 17 command paths had no executable coverage | §15 EPIC-009 gate    |

## 5. Git decisions

Classified against Bible conformance, test evidence, dependency impact and
migration safety — not against the incident's existence.

| Commit                                                                                 | Decision        | Basis                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `34e97df`, `a6d1c72`, `98ca696`, `eacfb61`, `5dc1e55`, `9463d2a`, `ded9ec6`, `542481b` | **KEEP**        | Implement real EPIC-008/009 behaviour; no invariant violated; the audit's findings are coverage, naming and undeclared deviation rather than wrong semantics |
| `01b5731` → `98ca696` (amend)                                                          | **KEEP**, noted | A local amend on an unpushed branch. No force-push reached the remote; `999999`-style history rewriting did not occur                                        |
| —                                                                                      | **REVERT**      | **none**                                                                                                                                                     |

Nothing was reverted. No commit both implemented something correctly and did so
in a way whose removal is cheaper than its repair.

## 6. Remediation

Recorded in full in [`../PHASE-5.5-RECOVERY-GATE.md`](../PHASE-5.5-RECOVERY-GATE.md).
In summary:

- **IR-01** — the conformance matrix above.
- **IR-02** — the P0 operator surface closed: `rebuild --projection <name>`
  implemented; `legacy patterns | pattern | convert` implemented per the frozen
  option B; executable coverage added for every P0 command, with exit code,
  success, refusal, invalid-argument and state-change semantics asserted. Three
  real defects were found while writing those tests and are recorded in
  `docs/断点记录.md` as BP-051.
- **IR-03** — `tests/replay/` and `tests/regression/` created, with a
  hand-computed golden fixture and the named regressions that had no equivalent
  elsewhere.
- **IR-04** — `pnpm verify` re-ordered to the frozen eleven steps; the
  dual-writer `dist` hazard (`BP-049`) removed rather than scheduled around.
- **IR-05** — Golden Fixture 01 recorded as `WAITING_FOR_AUTHOR_SOURCE`. It was
  **not** synthesised.

## 7. What the next agent should check first

1. Read the Bible in full. Then the Correction Pack in full. Neither is long.
2. Read this file and the conformance audit before reading any phase gate.
3. Inspect the git history: the recovery commits use the Bible's prefix
   convention and are small and separately auditable by design.
4. Re-run `pnpm verify`. It now prints its eleven steps in order, so a reader
   can see which step failed without reading the script.
5. Independently confirm the claim in section 4 that no invariant is violated.
   That claim is the whole basis for REPAIR rather than REVERT, and it is the
   one thing in this document that would change the recovery's shape if it were
   wrong.

## 8. Standing rule this incident establishes

**A review is only as complete as the brief it is given.** Dispatching auditors
does not substitute for reading the controlling document, and an audit whose
checklist was derived from an unread source inherits that source's gaps. Phase
gates must cite the Bible by section and line, not by paraphrase.
