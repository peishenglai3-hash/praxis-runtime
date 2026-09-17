# Phase 6V Material Request

**Status:** request — no item here has been supplied.
**Authority:** owner 6V-PREP brief, 2026-09-17, section 22.
**Phase 6V:** NOT STARTED.

## How to read this

Every item states exactly what is needed, where it must come from, the minimum
content that makes it usable, its privacy position, and which rung it blocks.
An item that cannot be met has an alternative listed, because "the author does
not have this" is a legitimate answer that changes the plan rather than stopping
it.

**Ordering rule:** items are ordered by the earliest rung they block, not by
size. `MR-07` is first because it blocks the very first rung and is the only one
that is a _decision_ rather than a _document_.

---

## MR-07 · Provider and model authorisation for 6V-0

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**         | 6V-0 "Adapter Reality Check" cannot execute without a real provider. The owner's Phase 6B brief forbade provider-specific production adapters, so writing one requires authorisation.                                                                                                                                                                                                |
| **Required source** | The owner, as a decision. No document exists to supply.                                                                                                                                                                                                                                                                                                                              |
| **Minimum content** | (a) which provider and model may be used; (b) written authorisation to write **one** minimal provider adapter inside `packages/adapters`, keeping provider SDK types behind the port; (c) whether live calls are billed to the owner and what ceiling applies; (d) whether the resulting adapter may be committed to a public repository.                                            |
| **Privacy concern** | Credentials must come from an OS environment variable or secret store. Bible section 13.2 forbids secrets in `praxis.config.json` and in event payloads; `SECURITY.md` repeats it. Nothing credential-shaped may be committed — push protection is enabled and will block it.                                                                                                        |
| **Blocks**          | **6V-0.** Nothing else in the ladder can start honestly until a real provider has been run against the boundary.                                                                                                                                                                                                                                                                     |
| **Alternatives**    | If no live provider is authorised: 6V-0 is reduced to a _recorded-transcript_ adapter (a replay of real provider responses captured elsewhere) and must be labelled `counterfactual: true`. That is materially weaker — it tests translation, not behaviour under a real network, real rate limits, real timeouts — and the rung would have to be recorded as `PARTIAL`, not `PASS`. |

**Why this is first.** Phase 6B's gate records five remaining gaps, and gap 2 is
"no provider adapter". That is not an omission the project can schedule around:
6V-0's entire purpose is 「prove Phase 6B contracts against real providers/tools」.
Every other item on this list can be worked while MR-07 is pending. This one
cannot.

---

## MR-01 · Golden Fixture 01 — the Production Card collaboration chain

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**         | Bible section 14's Golden Fixture 01: 「《红色源代码：洪湖篇》美术 Production Card 协作链的脱敏最小事件集」. It is the only rung that tests the mechanism against the author's actual practice.                                                                                                                                                                                                                                                                       |
| **Required source** | The conversation in which the art Production Cards were established and used. The tool does not matter; the turns do.                                                                                                                                                                                                                                                                                                                                                 |
| **Minimum content** | Five segments, in order. Partial satisfaction is useful and should be supplied partially rather than withheld:                                                                                                                                                                                                                                                                                                                                                        |
|                     | **01-a** — material judged insufficient, and the request for more material                                                                                                                                                                                                                                                                                                                                                                                            |
|                     | **01-b** — the Production Card created, and the user's review of it                                                                                                                                                                                                                                                                                                                                                                                                   |
|                     | **01-c** — the prompt frozen, and the generation that followed                                                                                                                                                                                                                                                                                                                                                                                                        |
|                     | **01-d** — a generation rejected by the user, **with the stated reason**                                                                                                                                                                                                                                                                                                                                                                                              |
|                     | **01-e** — the corrected generation, and what changed                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Format**          | Raw turns with timestamps if available. A ChatGPT/Claude export, a screenshot set, or a hand-copied transcript are all acceptable. **Do not summarise** — a summary is a derived record and cannot serve as the fixture.                                                                                                                                                                                                                                              |
| **Privacy concern** | `personal`. This is the author's own working history and it contains project material belonging to a third-party project. It must be **redacted before it enters the repository**, and the redaction itself must be recorded the way `docs/SOURCE-MANIFEST.md` records the DOCX sources: fingerprints in, bodies out.                                                                                                                                                 |
| **Blocks**          | The **Golden Fixture 01** rung, between 6V-2X and 6V-3. Not 6V-0, 6V-1 or 6V-2.                                                                                                                                                                                                                                                                                                                                                                                       |
| **Alternatives**    | None that preserve the fixture's purpose. Bible section 14 states the handling directly — 「素材不足 → 请求补素材」 — and synthesising it is forbidden. If the turns are genuinely unrecoverable, the honest outcome is that criterion 11 of the Alpha exit (`Golden Fixture 01 + 至少一个真实项目连续使用 ≥ 2 周`) is met by the _second half_ only and the fixture is recorded as permanently unobtainable. That is a decision for the owner and is not taken here. |

**What is already known to exist, so that this request is not answered with
duplicates:** 17 Jimeng-generated video files dated 2026-08-11 → 2026-09-08 with
generation prompts embedded in their filenames; `美术资产清单.md` (2026-08-06);
`红色源代码_二阶蒸馏白皮书_五轮最终版.docx` (2026-07-31);
`7.16键盘上的洪湖…docx` (2026-07-16); three dated PPT revisions. See
[`CORPUS-MANIFEST.md`](./CORPUS-MANIFEST.md) §I-01. **None of these is 01-d or
01-e.** `01-d` — the rejection with its reason — is the single most valuable
missing item in the entire corpus, because it is the only thing that can show
the runtime what a _recorded disagreement with an external verifier_ looks like
in this author's field.

---

## MR-02 · The skip-the-Production-Card counterexample

| Field               | Value                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**         | Bible section 14 requires it explicitly: 「至少加入一个“正式任务但用户要求跳过 Production Card”的反例，避免规则过拟合」. A fixture containing only confirmations teaches the promotion gate to promote.                             |
| **Required source** | A real occasion on which the author asked to skip the card for a real task.                                                                                                                                                         |
| **Minimum content** | The request to skip, and what happened next. If the skip was accepted, that is the strongest case. If it was refused and the card was used anyway, that is also useful but is a different fixture and should be labelled as such.   |
| **Privacy concern** | Same as MR-01.                                                                                                                                                                                                                      |
| **Blocks**          | The **Golden Fixture 01** rung. Without it the rung can still run but its exit condition — that the counterexample produces the documented outcome rather than a promoted rule — cannot be evaluated.                               |
| **Alternatives**    | If no real instance exists, say so. A synthetic counterexample may be added to CORPUS-C, but it must be labelled synthetic and it does **not** satisfy Bible section 14, which asks for this inside Golden Fixture 01 specifically. |

---

## MR-03 · A real failure-and-correction case the author still disagrees with

| Field               | Value                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**         | L2's exit condition is 「at least one case where the external verifier **disagreed** with the system's or the operator's assessment, and the disagreement was recorded as a residual rather than smoothed away」. A case the author has _not_ resolved is worth more than one they have. |
| **Required source** | The author's own recollection plus whatever artefacts survive.                                                                                                                                                                                                                           |
| **Minimum content** | What was expected; what happened; what the author believes the system or the AI got wrong; and — importantly — whether the author's view has changed since. A case where the author now thinks _they_ were wrong is equally valuable and should not be filtered out.                     |
| **Privacy concern** | `personal`.                                                                                                                                                                                                                                                                              |
| **Blocks**          | **6V-2.**                                                                                                                                                                                                                                                                                |
| **Alternatives**    | A published failure/debugging trajectory from CORPUS-E, which is materially weaker because the verifier is not the author's.                                                                                                                                                             |

---

## MR-04 · Which repeated workflow had its rule revised

| Field               | Value                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**         | The brief's I-04 definition is a workflow where 「a pattern formed, the pattern later failed, the rule was revised」. That is a _revision_ chain, and revisions are what the asset lifecycle is for.                                                               |
| **Required source** | The author, naming which of the candidates in `CORPUS-MANIFEST.md` §I-04 (if any) fits. **This request is for a pointer, not for the material.**                                                                                                                   |
| **Minimum content** | One sentence: which workflow, and what the rule changed from and to.                                                                                                                                                                                               |
| **Privacy concern** | None at the pointing stage.                                                                                                                                                                                                                                        |
| **Blocks**          | **6V-2**, and the I-04 track of CORPUS-I.                                                                                                                                                                                                                          |
| **Alternatives**    | If none fits, that is an answer and it is a finding: it would mean the project has no recorded instance of a rule being revised, which is exactly the case `ReusableAsset`'s challenge/disable/restore edges were built for and have never been exercised against. |

**Note on the five `lai-peisheng_skill_backup_*` / `*_staging_*` directories**
(2026-09-12, on the OneDrive Desktop): they are dated snapshots of a derived
skill and may contain exactly this revision chain. They were **not inspected**
during 6V-PREP. If the author confirms they are relevant, inspecting them is
cheap and does not require the author to produce anything further.

---

## MR-05 · Non-project everyday tasks

| Field               | Value                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**         | L1 and the owner's frozen prohibition: 「日常生活本身不得自动等价为 weak field」. L1 needs real low-consequence, reversible, short-feedback work — and it must be _placed_ on the axes, not assumed weak by genre. |
| **Required source** | The author, naming 3–5 ordinary recurring tasks they actually do with an AI.                                                                                                                                       |
| **Minimum content** | For each: roughly how often, what the output is, and how quickly a mistake is noticed. Do **not** pre-classify them as weak.                                                                                       |
| **Privacy concern** | `personal`, but low sensitivity. These need not be supplied as transcripts — a description is enough at this stage.                                                                                                |
| **Blocks**          | **6V-1.**                                                                                                                                                                                                          |
| **Alternatives**    | CORPUS-E low-consequence environments (a reversible task environment), which cover the mechanics but not the author's actual work.                                                                                 |

**Why this is not a formality.** The prohibition exists because the first draft
of the ladder sorted scenarios by how formal they felt. A casual recurring chat
about editing a document can carry `consequence: medium` if a wrong edit goes
out under the author's name, and a formal-looking project can be
`reversibility: easy` if it is a throwaway. The axes decide placement and
`placementRationale` is a required field in the run manifest for this reason.

---

## MR-06 · De-Lai participant data (6V-5)

| Field               | Value                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**         | 6V-5 asks whether Praxis produces value for someone who has not read The Final and does not share the author's high-reflection interaction style.                                                                                                                                                          |
| **Required source** | Not yet knowable. This item is recorded as a **future** request so the design happens before the recruiting, not after.                                                                                                                                                                                    |
| **Minimum content** | (a) participant profiles — the brief names programmer, humanities/social-science researcher, ordinary student, creator, low-AI-literacy user; (b) what each participant is told; (c) **informed consent for research use of their interaction records**; (d) where their data lives and how it is deleted. |
| **Privacy concern** | **The highest in this document.** This is third-party personal data from people who are not the owner. It requires consent, a defined retention period, and a deletion path. It must never enter the repository, not even redacted.                                                                        |
| **Blocks**          | **6V-5**, which is not scheduled.                                                                                                                                                                                                                                                                          |
| **Alternatives**    | None. If consent cannot be obtained, 6V-5 does not run and the generalisation question stays open. That is the correct outcome, not a reason to substitute proxies.                                                                                                                                        |

---

## What is deliberately **not** requested

- **A synthetic Golden Fixture 01.** Bible section 14 forbids it; the brief
  repeats the prohibition. Asking the author to approve a fabricated version
  would be asking them to authorise a false record.
- **A dataset download authorisation.** CORPUS-E is metadata-only during
  6V-PREP; a download decision is a 6V-1 decision and needs its own licence
  review.
- **A commitment to 6V-3.** The brief states knowledge-production testing
  requires separate author authorisation and is not part of this preparation.

## Summary table

| ID    | Item                                  | Blocks                 | Kind     | Can work continue without it?        |
| ----- | ------------------------------------- | ---------------------- | -------- | ------------------------------------ |
| MR-07 | Provider/model authorisation          | **6V-0**               | decision | No — 6V-0 is the first rung          |
| MR-01 | Golden Fixture 01 chain (01-a … 01-e) | Golden Fixture 01 rung | document | Yes — 6V-0/1/2 are independent       |
| MR-02 | Skip-the-card counterexample          | Golden Fixture 01 rung | document | Yes                                  |
| MR-03 | An unresolved real failure/correction | 6V-2                   | document | Partly — CORPUS-E substitutes weakly |
| MR-04 | Which workflow's rule was revised     | 6V-2, CORPUS-I I-04    | pointer  | Yes                                  |
| MR-05 | 3–5 everyday recurring tasks          | 6V-1                   | list     | Partly — CORPUS-E substitutes weakly |
| MR-06 | De-Lai participant data               | 6V-5                   | consent  | Yes — 6V-5 is unscheduled            |
