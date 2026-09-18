# CORPUS-I Register — 洪湖篇 interaction archive

**Date:** 2026-09-18
**Status:** identified, described, **not ingested**.
**Authority:** the owner, who supplied the locations on 2026-09-18 with the note
「这两个长周期交互案例可以作为参考 若本轮任务进展顺利 会给予更多真实的测试场景」.
**Companion:** [`CORPUS-MANIFEST.md`](CORPUS-MANIFEST.md) — the frozen definition
of the four corpus classes; §1 of that file is `CORPUS-I` and this register is
its first real content.

---

## 1. The rule this document is written under, before anything else

The repository is **MIT and public**. This material is the owner's personal
ethnographic record of a four-month collaboration, containing real project
paths, real filenames and a real working history. **Nothing from these
archives enters this repository.**

The manifest schema has a field for exactly this and it exists to be used:

```json
"corpusProvenance": {
  "inRepository": { "description": "False for anything the owner supplies that must not enter a public repository." }
}
```

Every future run over this material sets `inRepository: false` and
`privacyStatus: "personal"` or `"redacted"`. This register records _where the
material is and what shape it has_. It does not reproduce its contents, and no
experiment artefact derived from it may either.

## 2. What was found

The owner pointed at two locations. They are different in kind, and conflating
them would be a mistake.

### 2.1 `D:\红色源代码：洪湖篇\` — the substantive archive

A structured, machine-readable, already-de-identified research corpus.

**Primary data — `人机民族志档案_洪湖篇_20260908\01_研究工作层\`:**

| File                                 | Size    | Content                                                 |
| ------------------------------------ | ------- | ------------------------------------------------------- |
| `interaction_records.jsonl`          | 42.7 MB | **11,411 visible interaction records**                  |
| `artifact_records.jsonl`             | 3.8 MB  | 5,999 artefact facts (tool calls, with argument hashes) |
| `candidate_register.csv`             | 585 KB  | **2,050 candidate rows with dispositions**              |
| `production_type_map.csv`            | 7.5 MB  | 33,864 rows with an action taxonomy                     |
| `session_file_commit_map.csv`        | 2.6 MB  | 9,099 record→file and record→commit relations           |
| `workspace_provenance_records.jsonl` | 1.4 MB  | 1,732 provenance files                                  |
| `noncopied_assets_inventory.csv`     | 947 KB  | 3,306 entries                                           |
| `interaction_timeline.csv`           | 8.7 MB  | chronological view                                      |
| `EXPORT_RUN_SUMMARY.json`            | 1 KB    | the export's own totals                                 |

**A duplicate of the JSONL pair at** `交互记录\01_Codex_MD\` as
`Codex_interaction_records_full.jsonl` (42.7 MB) and
`Codex_artifact_records_full.jsonl` (3.8 MB), plus per-month Markdown renderings.

**A study document** at `交互记录\红色源代码·洪湖篇_人机交互民族志.docx` — a
10,221-character ethnography of two specific sessions, written from the same
logs. It is a _derived_ artefact and its `provenanceQuality` is `derived`, not
`primary`.

### 2.2 `D:\人机民族志档案_ClaudeCode_20260911\` — an index with no content

265 KB. A directory-level index of the Claude Code branch: 58 main sessions and
330 subagent sessions, 160,086 index rows, sourced from `cc-switch.db`.

**It contains no conversation text.** The README states this plainly
(「本档案**没有对话正文**。正文已于 2026-09-11 随 `~/.claude/projects/` 清理灭失。」),
and its own `coverage_gaps.md` records the loss. It is useful for one thing —
establishing that a session existed at a time, on a model, at a cost — and it
cannot support any experiment that needs to know what was said.

This matches what the project already recorded about the author's transcript
disposal. It is confirmation, not new material.

## 3. Why §2.1 is significant

The field names are, without having been designed for it, **a near-isomorphic
image of the runtime's own model**:

| Corpus-I field                                                                       | Praxis concept                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `interaction_records`                                                                | the append-first event ledger                         |
| `record_id` / `session_id`                                                           | event id / session grouping                           |
| `result_status`                                                                      | expectation and verification outcome                  |
| `artifact_records`                                                                   | artefacts and assets                                  |
| `candidate_register` + `disposition`                                                 | **candidate asset and its promotion decision**        |
| `production_types` (`ART`, `CODE`, `CONTENT`, `AUDIO`, `OPS`, `ORCH`, `REFL`)        | asset kinds                                           |
| `session_file_commit_map` (`record_to_file`, `record_to_commit`)                     | `EventLinks.derivedFrom`                              |
| `evidence_level` (`direct_record`, `artifact_fact`, `source_file_hash_and_metadata`) | `provenance.origin` and confidence                    |
| `scope` (`core` / `related` / `exclude`)                                             | relevance banding                                     |
| `actions` (`提问;约束;生成;工具调用;执行;测试;失败;修复;采纳;拒绝;回溯`)             | the action vocabulary a reflection would propose from |

The distribution of `result_status` across the 11,411 records:

| `result_status`                  | Count |
| -------------------------------- | ----- |
| 失败/暂停 — failed or paused     | 4,602 |
| 仅建议 — suggestion only         | 3,915 |
| 中间产物 — intermediate artefact | 1,834 |
| 已验证 — verified                | 962   |
| 待核验 — pending verification    | 57    |
| 已接入 — adopted                 | 41    |

Coverage: 2026-07-13 → 2026-09-08, across 286 session files of which 183 were
classified `core`, 27 `related` and 76 `exclude`.

## 4. The two findings that matter most

### 4.1 There is real ground truth for the asset subsystem

`candidate_register.csv` carries 2,050 rows, each with a `disposition` —
`included`, `excluded_candidate`, `included_as_context_only`. **This is an
independently authored record of which candidates a human kept and which they
rejected, over four months.**

That is the strongest external verifier this project has ever had access to for
`PromotionPrecision` and `PromotionRecall`. §18 lists both as metrics;
`CORPUS-MANIFEST.md` §2.6 says no external dataset can supply them. It was
right about external datasets. This is not one — it is the author's own
production record.

It is also the only available countermeasure to the risk §13 names —
「是否只对原作者有效？」 — because the accept/reject decisions are the author's
own, made before Praxis existed and therefore not shaped by it.

### 4.2 There are 4,602 real failure records

`result_status = 失败/暂停`. `CORPUS-MANIFEST.md` §2.5 ranks CORPUS-E material
for `Residual → Reflection → Repair`; this is that, at scale, on the author's own
work, with the author's own labels.

The 洪湖篇 ethnography documents four in detail and their resolution strategies
— a copyright block answered by downgrading an audio-level variation to a
style-level one; a quota exhaustion handed back to the human; a 429 answered by
serialising; an engine mismatch (Godot found to be a map editor, Phaser the real
runtime) found in plan mode and reported. Those four are close to a natural
`Residual → Reflection → Candidate` chain, authored by nobody involved in this
project.

## 5. What this material can and cannot support

**Can support, once ingested:**

- **V3 (long-term continuity).** Four months of real history is the longest
  sample available, and `CORPUS-MANIFEST.md` §2.6 records that no external
  dataset supplies long _project_ histories.
- **V2's human-production verifier.** §6 V2 names the 洪湖篇 Production Card
  workflow subset; this is its raw material.
- **Asset-promotion ground truth** (§4.1).
- **A retrospective falsification of the asset subsystem**: ingest the history
  up to a point, let Praxis propose candidates, and compare against what the
  author actually kept. A disagreement is the useful outcome.

**Cannot support:**

- **Any claim about Praxis's effect on outcomes.** These are records of a
  _different_ system. Praxis was not running. Retrospective ingestion measures
  whether Praxis _derives_ the right things from history, never whether having
  Praxis improves anything.
- **Golden Fixture 01, as specified.** GF01 requires five specific segments of
  one collaboration chain, and §16 forbids substituting material. That the
  archive is large does not mean the chain is in it. **The chain has not been
  located**, and locating it is the next step — not the same as having it.
- **`MR-05`** (non-project everyday tasks). The corpus is one project.
- **Anything about the De-Lai participant population** (`MR-06`). One author.

## 6. Provenance and licence

| Field               | Value                                                       | Basis                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceLocation`    | the two `D:\` paths in §2                                   | owner-supplied                                                                                                                                                              |
| `sourceLicence`     | **`UNVERIFIED`**                                            | Not a licence question the owner has addressed. The manifest schema says `UNVERIFIED` is a legitimate and common value and **is not permission**                            |
| `privacyStatus`     | `redacted`                                                  | The export has already replaced `<USER_HOME>` and `<HONGHU_WORKSPACE>` for absolute paths. Residual identifiability is **not established** and should be treated as present |
| `redactionRequired` | `true`                                                      |                                                                                                                                                                             |
| `provenanceQuality` | `primary` for the JSONL; `derived` for the ethnography docx |                                                                                                                                                                             |
| `inRepository`      | **`false`**                                                 | §1                                                                                                                                                                          |

**The `UNVERIFIED` licence is the load-bearing entry and should not be read past.**
The material is the author's own, which is a good answer to "may it be used" and
not an answer to "may it be redistributed". Nothing in this register proposes
redistribution, and no experiment artefact should contain excerpts.

## 7. What would let ingestion begin

Not a research question. Three steps, in order:

1. **The owner confirms the archive is readable by the project** and that
   derived, non-quoted artefacts (counts, ids, dispositions, metrics) may be
   committed to the public repository. A yes/no.
2. **An ingestion adapter**, owned by `evals/`, mapping `interaction_records`
   into `EventEnvelope`s. This is evaluation-side tooling and the ADR-0015
   direction permits it. It must be written so that the corpus path is a
   parameter and no excerpt is ever written to a manifest.
3. **A privacy pass** over whatever the adapter would emit, before the first
   `corpus-i` manifest is written. `privacyStatus: redacted` is a claim about
   the source, not about the derived artefact.

Until 1 happens, this register is the deliverable and ingestion is `NOT STARTED`.

## 8. On locating Golden Fixture 01

The owner's note says these are 「初步尝试」 and that more will follow if this
round goes well. GF01 needs `MR-01` — five segments of the Production Card
chain, of which segment 01-d (a rejection with its stated reason) is the most
valuable.

**The archive has not been searched for it.** Doing so is a bounded, mechanical
task: the logs carry `session_file_commit_map` relations and a
`production_type_map`, and a Production Card workflow would appear as a run of
`CONTENT` or `ART` records with tool calls against card-shaped paths. A search
would produce either the chain or a defensible negative.

It has not been done because it is not a prerequisite for anything in this
phase, and because guessing at the answer would be worse than reporting the gap.
`GOLDEN_FIXTURE_01_UNPLACED_IN_6V_ORDER` and `RFC MISMATCH:
GOLDEN_FIXTURE_01_ABSENT` therefore remain open, and GF01 remains
`WAITING_FOR_AUTHOR_SOURCE` — with the difference that the source is now known
to be _nearby_ rather than assumed to exist.
