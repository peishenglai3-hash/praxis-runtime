# GF01 Source Map — bounded discovery only

**Date:** 2026-09-18  
**Source:** an author-controlled local historical archive and its sibling interaction-record export. The machine-specific path is intentionally omitted from this public document.
**Safety boundary:** no raw session was ingested into Praxis, copied into this repository, or uploaded. The archive's licence, consent, and re-identification status remain **UNVERIFIED**.

## Result

**GF01 status: WAITING_FOR_AUTHOR_SOURCE.**

The bounded search established useful locator evidence, but not the complete historical chain required by the Bible. No dialogue or historical content has been reproduced here.

| Required chain element                                           | Status        | Evidence / exact locator                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author-controlled archive and de-identified research layer exist | **FOUND**     | The archive `README.md` states that the 2026-09-08 export contains 11,411 visible research-layer messages, 5,999 tool/artifact records, and a SHA-256-verified sealed source layer. The local path is not published.                                                                                                                    |
| Production Card artifact                                         | **FOUND**     | `01_研究工作层/interaction_records.jsonl:4841`, `record_id=01a01a48-801c-7ce0-b309-b11ca9a031db:11`, `source_id=codex:f7af3067fdcd63ad`, timestamp `2026-08-19T13:49:28` records a completed Production Card production Bible; `:4849` records its completion artifact. This is a locator, not an authorization to import the artifact. |
| Prompt/workflow constraint and approval/rejection signals        | **PARTIAL**   | The research layer records action labels including `约束`, `采纳`, `拒绝`, `回溯` and has `提示词`/`工作流` matches, but the bounded extraction did not establish that they belong to one GF01 chain. `interaction_records.jsonl:4840-4849` is the nearest Production Card-related cluster.                                             |
| Material insufficiency → explicit request for material           | **NOT FOUND** | Exact bounded searches for `素材不足`, `请求补素材`, and `补素材` did not find the required chain marker in the research layer; generic `原始材料` matches were unrelated or insufficient to establish the chain.                                                                                                                       |
| Generation → failure → correction → re-generation                | **PARTIAL**   | The research layer has action/status evidence for `生成失败` and `重新生成`/`重生成`; examples include `interaction_records.jsonl:6625-6637` and `:76`, `:113`, `:157`. These are separate records and are not claimed to be one coherent GF01 sequence.                                                                                |
| Stabilized workflow after re-generation                          | **NOT FOUND** | No bounded source reference was found that proves the complete chain ended in a frozen, stabilized workflow with the required provenance and human decision.                                                                                                                                                                            |
| Author-approved sanitized fixture suitable for ingestion         | **NOT FOUND** | `docs/eval/MATERIAL-REQUEST.md` and the RFC registry still record GF01 as absent/blocking; the archive's licence/consent status is unverified.                                                                                                                                                                                          |

## Search method

The discovery pass inspected archive indexes, the research-layer README/methods, the candidate/result registers, and bounded keyword matches in `01_研究工作层/interaction_records.jsonl` and `interaction_timeline.csv`. The sealed raw session tree was not bulk parsed into the project. Search terms covered Production Card/生产卡, material-insufficiency and supplementary-material phrases, prompt/workflow freeze, generation failure, correction, re-generation, style/scene/character mismatch, acceptance, and rejection.

## Why this remains waiting

The archive proves that relevant production interactions exist, and it provides stable `record_id`/`source_id` locators. It does not, in the bounded evidence currently approved, prove the exact minimal event sequence needed for GF01, nor does it establish that the historical material may be copied into a repository or used as an evaluation corpus. Creating a synthetic “equivalent” would violate the Round 1 instruction.

Next safe step: the author supplies or explicitly approves a small, de-identified, provenance/licence-cleared subset containing the missing chain. Until then, GF01 remains `WAITING_FOR_AUTHOR_SOURCE`, and no historical corpus upload is authorized.
