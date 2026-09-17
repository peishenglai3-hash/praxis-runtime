# Phase 6V Corpus Manifest

**Status:** proposed — reconnaissance only. Nothing here has been downloaded,
copied or committed.
**Authority:** owner 6V-PREP brief, 2026-09-17, Track B.
**Phase 6V:** NOT STARTED. Alpha release: `NO-GO`.
**Rule this document obeys:** every episode carries a `corpus_type`, and the four
classes are not interchangeable.

## 0. Why the four classes are frozen

A single pile of "test material" would let a synthetic counterexample be read as
history, and a prospective run be re-labelled after its outcome was known. The
classes exist so that the weakest evidence in a result is visible from the
result. They map onto `corpusType` in
[`schemas/eval/run-manifest.v1.schema.json`](../../schemas/eval/run-manifest.v1.schema.json).

| Class        | What it is                                             | What it can support                                             | What it can never support                            |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| **CORPUS-I** | Internal real historical material                      | "the mechanism meets the author's actual practice"              | "the mechanism works in general"                     |
| **CORPUS-E** | External benchmark / trajectory material               | "the mechanism behaves comparably on a published task"          | "the mechanism is right for this author's field"     |
| **CORPUS-P** | Prospective real experiments, expectation frozen first | causal claims about this runtime, because the baseline is prior | anything about scenarios not run                     |
| **CORPUS-C** | Synthetic / adversarial counterexamples                | "the mechanism handles this constructed case"                   | anything about frequency, likelihood or real history |

**The one rule that carries the most weight:** CORPUS-C material is a test case,
not evidence. It may be committed to the repository; CORPUS-I material may not.

---

## 1. CORPUS-I — internal real historical material

### I-01 · 《红色源代码：洪湖篇》 art production

**Status: PARTIAL.** The project artefacts exist on the owner's workstation and
several are directly relevant. The **collaboration record does not**, and that
is the part Golden Fixture 01 needs.

#### I-01a — found and characterised (not copied, not committed)

| Item                                                               | Owner location | Date                               | Size                  | What it is                                                                                                                                             | 6V use                   |
| ------------------------------------------------------------------ | -------------- | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `美术资产清单.md` / `美术资产清单.docx`                            | Downloads      | 2026-08-06                         | 38/43 KB              | Full project art asset inventory V1.0: 8 base environments, layered map structure, per-chapter prop and character tables, UI inventory, priority tiers | **primary** — see below  |
| `jimeng-*.mp4` × 17                                                | Downloads      | 2026-08-11 → 2026-09-08            | 2–18 MB               | Generated video takes from 即梦/Jimeng. **The filenames embed the generation prompt text.**                                                            | generation-step evidence |
| `红色源代码_二阶蒸馏白皮书_五轮最终版.docx`                        | Downloads      | 2026-07-31                         | 105 KB                | Second-order distillation whitepaper, five-round final version                                                                                         | project context          |
| `7.16键盘上的洪湖：作为分布式历史解释实验室的人机共创.docx`        | Downloads      | 2026-07-16                         | 128 KB                | Methodology essay on the project as a human–AI co-creation laboratory                                                                                  | **candidate** — see I-04 |
| `红色源代码_洪湖篇_科创奖答辩PPT_V1.0/V4.0最终版/V5.0_最终版.pptx` | Downloads      | 2026-09-07, 2026-09-07, 2026-09-15 | 35 KB / 52 MB / 16 MB | Three dated revisions of the same deliverable                                                                                                          | iteration trail          |
| `MAP_MOD_BASE_现代实践驻地_模块化环境资产包.png`                   | Downloads      | 2026-08-07                         | 2.1 MB                | A produced modular environment asset pack                                                                                                              | artefact evidence        |

**Collection protocol:** owner-supplied, outside the repository, `privacyStatus: personal`.
None of it enters a public MIT repository. Fingerprints would be recorded in
`docs/SOURCE-MANIFEST.md` in the same way the DOCX sources already are.

#### I-01b — why `美术资产清单.md` matters more than its title suggests

Read directly, it is not merely a list. It contains a working practice the
Bible's Golden Fixture 01 is looking for, stated as rules:

> 「现场照片不足时，不擅自增加石狮、旗杆、花坛等纪念性元素」 — when site
> photographs are insufficient, do not add commemorative elements on your own
> initiative.
>
> 「实拍物的形制需标注“参考物”还是“事件原物”，不能在画面中自动等同于历史原件」
> — a photographed object must be marked as _reference object_ or _event
> original_; it may not be silently equated with the historical item.
>
> 「历史人物只保证“身份可辨认”，不做未经史料支持的精确五官」 — for real
> historical figures, guarantee only that identity is recognisable; do not
> render features the historical record does not support.
>
> 「火种、铁皮桶和具体爆响物如史料尚未核准，应制作成可替换资产，不与底图合并」
> — where the historical record is not yet verified, produce a replaceable
> asset rather than baking it into the base layer.
>
> 「刘绍南…面部不做强特征…不制作未经依据的伤疤、军装、勋章、长风衣」
> — where photographic and reliable material is insufficient, do not invent.

**This is a real, dated, author-written instance of exactly the discipline the
runtime is supposed to support**: a claim whose evidence is insufficient is
marked as such, kept replaceable, and prevented from hardening into a fact. It
is not a Production Card and it is not a correction chain, so it does not
satisfy Golden Fixture 01. It is, however, primary written evidence of the
author's own rule about provenance under material scarcity, and it is usable in
`corpus-i` for L2 without any reconstruction.

**What it does not contain:** no timestamps of decisions, no rejected
generations, no user refusal, no correction message, no approval. A document of
rules cannot substitute for a record of turns, and this manifest does not
pretend otherwise.

#### I-01c — MISSING (this is the Golden Fixture 01 gap)

| Missing item                                                                         | Why it cannot be reconstructed                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| The Production Card artefacts themselves                                             | Never found on disk under any name searched                       |
| The conversation turns of the art-production chain                                   | No chat export exists on this workstation under any path searched |
| The specific generation that produced a wrong character count, and its rejection     | That is a turn, and a turn cannot be inferred from an output file |
| The explicit user refusal and the correction message that followed                   | Same                                                              |
| The counterexample: a real task where the user **asked to skip** the Production Card | Bible section 14 requires it specifically to prevent over-fitting |

**Searched and not found:** every path under `Documents`, `Downloads`, `Desktop`,
`OneDrive` and `.codex` at depth ≤ 4 for `Production Card`, `制作单`, `制作卡`,
`生产卡`; every `*.jsonl`, `conversations*.json` and `chat*.json` outside
`node_modules`. The absence is reported as an absence — no match is not proof
that no such file exists, and see I-03 for one place material of this shape
_did_ turn up.

#### I-01d — the asymmetry worth stating plainly

The _outputs_ of the collaboration survived: 17 generated videos with their
prompts in the filenames, three dated PPT revisions, an asset inventory, and a
methodology essay. The _turns_ did not.

That asymmetry is itself a finding about the field this runtime is for. What a
person keeps is the artefact; what the mechanism needs is the correction. Every
prospective run under CORPUS-P exists because of this gap.

---

### I-02 · INC-001 partial-Bible execution

**Status: COMPLETE and in-repository.** This is the strongest corpus-i item the
project has, and it is already machine-readable in part.

| Item                                         | Location                                                                                               | Quality          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| Incident narrative with timeline             | [`docs/incidents/INC-001-partial-bible-execution.md`](../incidents/INC-001-partial-bible-execution.md) | primary          |
| Requirement-by-requirement conformance audit | [`docs/incidents/INC-001-bible-conformance-audit.md`](../incidents/INC-001-bible-conformance-audit.md) | primary          |
| Recovery gate                                | [`docs/PHASE-5.5-RECOVERY-GATE.md`](../PHASE-5.5-RECOVERY-GATE.md)                                     | primary          |
| `BP-050` — the root-cause record             | [`docs/断点记录.md`](../%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md)                                       | primary          |
| Git history `542481b` → recovery tip         | repository                                                                                             | primary          |
| The executing model's own session transcript | `~/.claude/projects/` (Claude Code session logs)                                                       | primary, private |

**Usable as:** a real specification → incomplete representation → action → drift
→ detection → human re-entry → repair → new rule chain, with a verifiable
external outcome (the conformance matrix) and a written root cause.

**Why it is not Golden Fixture 01:** it is an engineering incident, not an
art-production collaboration, and the Bible names the art chain specifically.
It is nonetheless the only corpus-i item with a complete turn-level record, and
`BP-052`/`BP-053`/`BP-054`/`BP-055`/`BP-058` are five separate _recorded false
findings by the auditing agent_, which makes it unusual material for evaluating
**FalseResidualRate on an auditor that is itself the subject**.

**Privacy:** the session transcript contains the owner's private working
conversation. `privacyStatus: personal`; not committable.

---

### I-03 · codex-habit (generation 1)

**Status: PARTIAL — and the gap is large.**

| Item                       | Location                                            | Observed                                                                                                                           |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Generation-1 runtime home  | `~/.codex-habit/`                                   | Present. `patterns/active/` holds **294 pattern files**; `.graph_state.json`, `.signals_index.json`, `.signal_buffer.json` present |
| Generation-1 event log     | `~/.codex-habit/.events/`                           | **Directory exists and is EMPTY.** No `event.log`, no `evt_*.json`                                                                 |
| Audit baseline copy        | `%TEMP%/codex-habit-c3be4af/`                       | Present; `data/` holds only `profile/`                                                                                             |
| First-generation source    | `github.com/peishenglai3-hash/codex-habit` (public) | The Bible's named audit baseline `main@c3be4af`                                                                                    |
| Synthetic importer fixture | [`fixtures/legacy/`](../../fixtures/legacy/)        | In-repository, synthetic, byte-exact — **implementation evidence, not history**                                                    |

**The important negative result.** The generation-1 `.events` directory is
empty. That is consistent with the defect class the migration was built for —
`possible_overwrite` / signal-ID collision — and it means the 294 surviving
patterns are a _derived_ product whose raw input is missing. Anything built on
them is `provenanceQuality: derived` at best.

**This is not a defect to report as new.** It is already recorded:
[`docs/migration/LEGACY-FIELD-MAP.md`](../migration/LEGACY-FIELD-MAP.md) and
`ADR-0012`. What is new here is only that the corpus manifest can now say the
generation-1 ledger is empty **on this workstation**, and that the 294 patterns
are therefore not reproducible from their own source.

**6V use:** the `patterns/active/` set is a real, if degraded, corpus of
_proposed reusable assets that were never validated_ — 294 of them, created by
a system with no counterexample tracking and no exposure lineage. Reading them
against the current promotion policy is a legitimate **corpus-i** exercise for
L2: how many would the present gate have let through, and how many would it have
refused for missing provenance? That question has a computable answer and a real
answer is a finding either way.

---

### I-04 · Other repeated author–AI workflows

**Status: IDENTIFIED, NOT INSPECTED.** Listed as candidates with names and
dates only. **This manifest does not claim to know what is in them.**

| Candidate                                                 | Location           | Date       | Why it is a candidate                                                                           |
| --------------------------------------------------------- | ------------------ | ---------- | ----------------------------------------------------------------------------------------------- |
| `赖培胜选集/` — five volumes plus 暑期论文集, 随笔集      | OneDrive Desktop   | 2026-08    | A large authored corpus carried across many sessions                                            |
| `赖选 第三卷/开发心得(1).docx`                            | within the above   | 2026-08-26 | "Development notes"                                                                             |
| `赖选 第三卷/写在游戏上线之后.docx`                       | within the above   | 2026-09-03 | Written _after the game shipped_ — a retrospective over a completed project                     |
| `赖选 第三卷/0729思考-赖.docx`, `写在回武汉的飞机上.docx` | within the above   | 2026-09-03 | Dated thinking records alongside the main line                                                  |
| `.codex/skills/lai-peisheng/`                             | `~/.codex/skills/` | 2026-09    | A **skill** derived from the author — the closest thing to a promoted ReusableAsset that exists |
| `lai-peisheng_skill_backup_*`, `*_staging_*` (×5 dirs)    | OneDrive Desktop   | 2026-09-12 | Five dated backup/staging directories — an iteration trail, if they hold anything               |

**Two negative results recorded so the positives are not over-read:**

- `.qa_original_the_final/`, `.qa_revised_the_final/` and
  `docx_review_the_final_supplement_20260912/` **exist and are empty**. Their
  names suggest a QA or review round; the directories hold no files. An empty
  directory is not evidence that a review happened, and it is not evidence that
  one did not.
- No chat export was found anywhere. Whatever turn-level record exists for these
  workflows is on a service, not on this disk.

**What would make I-04 usable:** the author naming which of these is a _repeated_
workflow whose rule later changed. That is the I-04 definition in the brief —
「a pattern formed, the pattern later failed, the rule was revised」 — and it is
a question only the author can answer. It is in
[`MATERIAL-REQUEST.md`](./MATERIAL-REQUEST.md) as `MR-04`.

---

## 2. CORPUS-E — external benchmark and trajectory material

**Status: reconnaissance complete, metadata only.** The scan covered both
memory/temporal benchmarks (E1) and agent failure/debug trajectories (E2). The
selection rules and the findings are below.

**Evidence boundary for this section, recorded rather than glossed.** `WebFetch`
is **blocked in this environment** — it was attempted against `github.com` and
`huggingface.co` and failed on both with a domain-safety error. Every finding
below therefore rests on **search-result summaries**, which are themselves
second-order. **No page was opened directly. Nothing was downloaded.** Every
licence is _reported_; every size is _reported_; no row count, token count or
gating claim was verified. Several 2026 identifiers rest on consistent
multi-source mention rather than independent confirmation. Treat every licence
in this section as needing verification by eye before anything is committed.

### Selection rules (owner's brief section 9)

- **Nothing is downloaded during 6V-PREP.** Metadata only.
- Early 6V uses **20–100 episode smoke subsets**, not full datasets.
- **Licence is a gate, not a footnote.** This repository is MIT and public. A
  dataset whose licence is unclear or non-permissive cannot be committed here,
  and `UNVERIFIED` is a legitimate value that is **not** permission.
- **Privacy is a gate.** Material containing real people's private conversations
  is `corpus-e` only in a redacted or aggregate form, if at all.

### Constraints this corpus cannot satisfy, stated in advance

1. **No external benchmark tests this runtime's actual claim.** The claim is
   about a _single long-term human–AI collaboration with an author who
   re-enters_. Benchmarks measure task completion by an agent. A good score
   would not be evidence for the claim, and a bad one would not be evidence
   against it.
2. **Weak-field behaviour is almost untestable externally.** The Bible's rule
   that 「weak verification 场景中，默认保留 uncertainty」 is about _not_
   acting. Benchmarks score acting. A benchmark can therefore show a false
   positive (the runtime declined and lost points) and cannot distinguish it
   from a true positive (the runtime correctly abstained).
3. **No benchmark carries the author's history.** Golden Fixture 01 is
   irreplaceable for exactly this reason.
4. **Scaffold portability needs the same task on two subjects.** Most published
   trajectory corpora are one model on many tasks, not many models on one task.
   That inversion is the specific thing C2 needs and the specific thing the
   corpus is least likely to supply — it may have to be constructed
   prospectively under CORPUS-P.

### Where CORPUS-E is genuinely useful

- **L1 (does the runtime stay quiet):** a low-consequence reversible environment
  gives a fixed task set where an unnecessary residual is unambiguously
  unnecessary. This is the one rung where an external corpus answers the
  question directly.
- **L2 (does the loop form correctly):** failure/debugging trajectories that
  carry _failure + root cause + evidence + correction + verifier outcome_ are
  the closest published analogue to `Expectation → Observation → Residual →
Reflection → Repair`.
- **Calibration of the detector, not of the claim:** running the residual
  detector over someone else's trajectory tells us its false-positive rate
  against a labelled ground truth. That is a real and useful measurement, and it
  is a measurement about the _detector_, not about the runtime's value.

### 2.1 Name resolution — one term in the brief does not exist

The brief names **"MemoryCraft"** as a candidate. No benchmark by that name was
found. The closest match, `THUIR/MemCraft`, is a _memory plugin_ for OpenClaw —
a system, not a benchmark — and it benchmarks itself against baselines
reproduced from **MemoryBench**. The brief's "unified memory harness" is almost
certainly the **Agent Memory Leaderboard (AML)**. Both are recorded below under
their real names. `MemCraft` is dropped as a search term.

### 2.2 Licence traffic light

This repository is MIT and public. **A non-permissive or unverified licence is
a blocker for committing data, not a caveat on a result.** `UNVERIFIED` is a
legitimate and common value here, and it is not permission.

| Verdict                             | Datasets                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permissive — usable if verified** | LongMemEval / -cleaned (MIT) · MemoryAgentBench (MIT) · **KUQ (MIT)** · SWE-bench (MIT repo; HF card has no tag) · nebius SWE-agent-trajectories (CC BY 4.0 + per-repo + Llama 3.1 rider) · SWE-rebench **V1** (CC BY 4.0) · nebius SWE-rebench-openhands-trajectories (CC BY 4.0) · **CUA Debugger Trajectories (Apache-2.0)** · TRAIL (MIT **but gated** and carrying an eval-only rider) |
| **Blocked — non-permissive**        | **LoCoMo (CC BY-NC 4.0)** · **AbstentionBench (CC BY-NC 4.0** + third-party terms) · **SelfAware (CC BY-SA 4.0** — viral) · **MAST paper (CC BY-NC-ND 4.0)** · SWE-smith _data_ (toolkit MIT, but source repos include GPL v3.0 / LGPL — copyleft cannot be relicensed MIT)                                                                                                                 |
| **Blocked — licence unverified**    | SWE-rebench **V2** (`license: other`) · BEAM · LongMemEval-V2 · Memora · LoCoMo-Plus · Mem2ActBench · MemoryBench (THUIR) _data_ · AML · LongRCA · Who&When · AgentLens · TraceProbe · Beyond Final Code · WindowsAgentArena                                                                                                                                                                |

**The trap worth naming:** a permissive licence on a toolkit does not license the
data its tasks were mined from. SWE-smith and the nebius trajectory sets both
carry per-instance repository licences, and nebius additionally attaches a
Llama 3.1 rider to model-derived outputs. Committing a _downloader script plus a
hash_ is a materially lower-risk act than committing the bytes, and that is the
route this project should take if it commits anything.

### 2.3 Privacy

**One dataset in the entire scan holds real people's data:**
`OpenHands/openhands-feedback` — 275 real user interactions, contributed under
consent, emails and sensitive content removed, 60% positive / 40% negative
feedback. It is MIT-licensed. **Consent to publish is not consent to reuse for
a different purpose**, and it is treated here as human-subjects data: at most a
handful of episodes as format inspiration, after an explicit privacy review, and
never as a training or tuning input.

Everything else is synthetic, machine-generated, or public GitHub content.
SWE-bench-family sets contain public usernames and issue text, which is public
but is still personal data in the ordinary sense.

### 2.4 E1 — long-term memory and temporal retrieval

| Dataset                                                           | Licence              | Fit                                                                                                                                                               | Recommendation                                                                                            |
| ----------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **MemoryAgentBench**                                              | MIT                  | Best value-per-byte. Purpose-built **FactConsolidation SH/MH** (contradiction) + **EventQA** (temporal) + a conflict-resolution slice                             | **USE SUBSET** — 20–40 FactConsolidation + 20 EventQA                                                     |
| **KUQ**                                                           | MIT                  | ~6,884 items, **~50/50 known/unknown**. Unknown categories include False Assumption, Counterfactual, Future Unknown                                               | **USE SUBSET** — 50–100 balanced items. Best L1 smoke                                                     |
| **LongMemEval / -cleaned**                                        | MIT                  | Temporal reasoning (133 q), knowledge update (78 q), abstention. Synthetic conversations                                                                          | **USE SUBSET** — 20–50 from the oracle file. Note the original card is deprecated in favour of `-cleaned` |
| **SWE-rebench V1**                                                | CC BY 4.0            | Fail-to-pass tests verified by execution, per-instance creation dates, monthly splits, prebuilt Docker images                                                     | **USE SUBSET** — 20–50 from the 860-task leaderboard split                                                |
| **BEAM**                                                          | UNVERIFIED           | 10 scored abilities incl. abstention + contradiction resolution; **contradiction resolution is near-zero for every method**, so the axis is unsaturated           | Use **128K tier only**, 20–35 conversations; licence first                                                |
| **MemoryBench (THUIR)**                                           | data UNVERIFIED      | Declarative vs procedural memory; four evaluation regimes; catastrophic-forgetting detection. Headline negative result: memory systems do not beat plain BM25 RAG | Metadata only until the HF licence is confirmed                                                           |
| **Memora / FAMA**                                                 | UNVERIFIED           | **The single most on-target artefact for stale facts** — the FAMA metric explicitly penalises reliance on invalidated memory. Availability unconfirmed            | Metadata only. **Hypothesis:** if released, this is the primary stale-fact axis                           |
| **LongMemEval-V2**                                                | UNVERIFIED           | "**Environment gotchas**" and "**premise awareness**" — a fact valid elsewhere but wrong in _this_ deployment. The most project-shaped abilities found            | Metadata only — up to 115M tokens/haystack, 140–186 s/query                                               |
| **AML**                                                           | UNVERIFIED           | Not a dataset — a gated harness requiring you to host Add/Search endpoints. Its capability taxonomy and versioned evaluation contract are the reusable parts      | Metadata only. **Read it; do not join it**                                                                |
| LoCoMo · LoCoMo-Plus · Mem2ActBench · AbstentionBench · SelfAware | blocked / unverified | Widely reused but shallow (a 2026 ACL line argues 94% of LoCoMo questions need ≤2 sessions)                                                                       | Reject as data; the **AbstentionBench scenario taxonomy** may be adopted by citation                      |

### 2.5 E2 — failure and debug trajectories, ranked for `Residual → Reflection → Repair`

1. **CUA Debugger Trajectories / CUAErrorBench** — Apache-2.0, 204 failed OSWorld
   episodes. The only set carrying failure + `root_error_step` + **free-text
   grounded evidence** + **a suggested correction** + per-episode annotation
   confidence, with a companion paper that re-executes the repair and reports
   recovery (13.89% → 29.86%). It supplies four of the five stages; only the
   registered Expectation is missing, and that is this project's own to add.
   **USE SUBSET — 30–60 episodes.**
2. **TRAIL** — MIT, gated, eval-only rider. 148 traces, 841 human-annotated
   step-level errors, in OpenTelemetry span format. The best available _input
   shape_ for Reflection, and evidence that step localisation is genuinely hard
   (best joint accuracy 11%). No corrections, no post-repair outcomes.
   **USE SUBSET — 20–50 traces** after checking the rider.
3. **LongRCA Bench** — 1,140 _naturally occurring_ failures, mean 156 steps,
   human role and root-step labels, 13.2% best baseline. The best long-horizon
   match, and the licence is entirely unstated. Metadata only for now.
4. **MAST-Data** — 1,642 traces, 14 failure modes. **Adopt the taxonomy now**:
   its FC3 family (premature termination, no/incomplete verification, incorrect
   verification) names exactly what a verifier-bearing Expectation exists to
   prevent, and "Reasoning-Action Mismatch" maps onto a residual of kind `rule`.
   Use the data cautiously — the full set is LLM-judge-labelled and only 19
   traces are human-labelled, so label fidelity is unproven.
5. **Beyond Final Code** — 3,977 solving + 3,931 **testing-phase** trajectories.
   Unusual in capturing the repair phase as first-class data. Licence unverified.
6. **nebius/SWE-rebench-openhands-trajectories** — CC BY 4.0, 67,074
   trajectories at ~48/52 success/failure. Not failure-annotated, but the
   cleanest large outcome-labelled corpus for calibrating the detector's
   false-positive rate. **USE SUBSET — 20–50 failed + 20–50 successful.**
7. **Who&When** — 184 failure tasks with who/when/why attribution. Higher
   priority for L4 than for L2. Licence unverified.

**Two findings that matter more than any individual dataset:**

- **`AgentLens`'s "Lucky Pass" result** — 10.7% of _passing_ SWE-agent
  trajectories succeeded without a legitimate solution path. That is precisely
  the failure mode the promotion rule must not reward: an apparent success that
  should not become an asset. The data is unreleased; the **concept** is usable
  now, and it belongs in the CORPUS-C design.
- **`SWE-smith`'s injected bugs** are the closest public analogue to
  instrumented fault injection: for every failed trajectory the true cause of
  the residual is known _by construction_ rather than inferred. That is the
  property a `Residual → Reflection` evaluation actually needs, subject to the
  copyleft problem above.

### 2.6 What no dataset in this corpus can supply

Stated plainly, because it bounds every external result:

> **No dataset found in this scan contains a registered expectation with a
> verifier stated before the run, or a reflection decision recorded with its
> budget.** They record what happened and sometimes what should have happened.
> An evaluation of the Reflection controller is therefore an evaluation of _this
> runtime on top of_ those traces, never an evaluation the traces themselves can
> supply.

Four further claims that **cannot** generalise, each of which should be treated
as a red flag if it appears in a Phase 6V report:

1. **Resolution-rate scores.** SWE-bench-style success is an autonomous agent
   solving an issue with no human in the loop, no registered expectation and no
   budgeted controller.
2. **Retrieval-accuracy scores.** LongMemEval, LoCoMo and BEAM score a reader
   over a supplied haystack. They have no notion of STOP/CONTINUE/ESCALATE and
   no notion of consequence.
3. **LLM-judge verifiers are not external verifiers.** Where the project needs a
   crisp verifier, the SWE-\\* execution harnesses are the right import — not the
   memory benchmarks.
4. **Single-run computer-use numbers.** OSWorld/WindowsAgentArena variance is
   reported to be dominated by data draw and run-to-run nondeterminism, and
   infeasible-task scoring is reported to misrank weaker agents. Rejected here on
   cost _and_ variance.

### 2.6b E3 / E4 — reversible environments and multi-model trajectories

Same evidence boundary: search summaries only, no page opened, no licence
verified.

**E3 — environments for "does the runtime stay quiet".**

| Item                        | Licence                                  | Why it is here                                                                                                              | Recommendation                                                                                                                                    |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALFWorld**                | MIT (reported)                           | Reversible, immediate feedback, routine stretches where nothing warrants action                                             | **USE SUBSET — 30–60 episodes.** Primary for 6V-1C                                                                                                |
| **TextWorld**               | MIT (reported)                           | A _generation tool_: can produce seeded trivial games                                                                       | **USE FULL.** This is the controlled "nothing warrants anything" condition — the only way to build a labelled negative set rather than assume one |
| **ScienceWorld**            | Apache-2.0 (reported)                    | 30 tasks / ~7,200 variants with a graded 0–100 validator                                                                    | USE SUBSET — 20–40                                                                                                                                |
| **tau-bench / tau2 / tau3** | MIT (reported)                           | **Ships `historical_trajectories/{model}-{env}.json` with reward and full message arrays** — same task, more than one model | Reuse the shipped trajectories, 20–40 tasks. Also the nearest thing to a _user-turn_ baseline                                                     |
| **AppWorld**                | Apache-2.0 + encrypted bundle conditions | Has a **collateral-damage** verifier — "did more than warranted"                                                            | USE SUBSET — 20–40. The closest published analogue to a false-positive action                                                                     |
| WebArena                    | Apache-2.0 (reported)                    | —                                                                                                                           | Metadata only for now                                                                                                                             |
| WorkArena                   | **UNSTATED**                             | —                                                                                                                           | **Flag — do not reuse**                                                                                                                           |
| Jericho                     | GPL-2.0 (reported) + Linux-only          | —                                                                                                                           | Reject early on licence and platform                                                                                                              |

**Over-reflection instruments, which are methodology rather than data:** the
Overthinking trajectory set (4,018 rated trajectories), When2Call, When2Tool,
SMART-ER (per-step tool-necessity labels), MCPAgentBench TEFS. **All licences
UNVERIFIED.** All of them measure tool calls or reasoning tokens — **none
measures residual, reflection or candidate-asset machinery**, so none can
score this runtime's central claim directly.

**E4 — multi-model and multi-agent trajectory material.**

| Item                            | Licence                   | Why it matters                                                                                                                                                                                 |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-SWE-bench_trajs**       | UNVERIFIED                | **9 models × 3 scaffolds (Agentless / SWE-agent / OpenHands), 1,632 tasks.** The best factorial same-task cross-model × cross-scaffold design found. Exactly what C2 wants — but licence first |
| **Exgentic / agent-llm-traces** | CDLA-Permissive-2.0       | 1,781 OTel traces, 5 frameworks × 5 models × 6 benchmarks incl. tau2 suites. **No ground-truth labels**, and task-level pairing is unverified                                                  |
| **HAL**                         | UNVERIFIED (hosting)      | 21,730 rollouts, 9 models × 9 benchmarks. Reported finding worth carrying: **higher reasoning effort reduced accuracy in 21 of 36 comparisons**                                                |
| **GateMem**                     | CC-BY-4.0 data / MIT code | 91 episodes, 2,218 checkpoints, 6 LLMs — the closest thing to stale and shared memory governance _with_ ground truth                                                                           |
| SWE-rebench trajectories        | CC BY 4.0                 | 67,074 trajectories / 32,161 successful — an explicit success/failure balance                                                                                                                  |
| MAST / MAD · Who&When · TRAIL   | mixed / unverified        | Covered in §2.5                                                                                                                                                                                |

**Privacy flags, recorded so they are not discovered later:** `DEBATE` (seantw)
contains real people's debates and private opinions under a
research-only non-commercial term — **reject**. `WildClawBench` has contested
provenance from real OpenClaw user records with no documented consent — metadata
only. `LMCache` traces embed WildClaw sessions — metadata only. GAIA-derived
corpora (TRAIL, Who&When) carry a mild flag.

**The E4 conclusion that matters most: no single dataset performs cross-scaffold
or cross-provider comparison.** It must be composed — the frozen scenarios run
under this project's own two configurations, with those corpora as comparison
scaffolding rather than as the experiment.

**Five things that do not exist and would have to be built by this project:**

1. A matched frozen-scenario comparison that publishes run-internal machinery.
2. A **labelled "nothing-warranted" episode set** — the thing 6V-1's whole
   question depends on. TextWorld can generate the games; the labels are this
   project's to place.
3. A concurrent multi-agent interference benchmark. Existing concurrency work in
   the field is serving-level (throughput, cache) and measures nothing about
   agents sharing state.
4. Stale-state / asynchronous collaboration traces **with ground truth**.
5. A transactive-memory dataset carrying a verifier.

### 2.7 Answering the brief's "which datasets are too large, expensive or misaligned"

- **Too large:** LongMemEval-V2 (115M-token haystacks) · BEAM 1M/10M tiers.
- **Too expensive to set up:** OSWorld / WindowsAgentArena (full desktop VMs;
  Windows 11 Enterprise Evaluation ISO + activated Office) · SWE-smith's 250+
  Docker environments.
- **Misaligned by construction:** AML (a gated harness that publishes no data) ·
  OpenInterpretability's activation-level traces (depend on one model's residual
  stream, not portable to a local runtime).
- **Misaligned with a public MIT repository** regardless of scientific fit:
  everything in the "blocked" rows of §2.2.

---

## 3. CORPUS-P — prospective experiments

**Status: none exist. This is the only corpus that can carry a causal claim.**

Rules, from the owner's brief section 10:

- The expectation is registered **before** the run and is never reconstructed
  after it. A record whose expectation was written afterwards is not prospective
  evidence; it is `corpus-i` at best and must be labelled as such or discarded.
- Every run carries a complete
  [`run-manifest`](../../schemas/eval/run-manifest.v1.schema.json).
- Nothing under CORPUS-P may be run during 6V-PREP.

**Minimum first tranche (proposed, not authorised):** 6V-0 requires **zero**
manifests because it exercises adapters rather than the loop. 6V-1 should open
with a small set — the schema exists so that the first run costs one file, not a
harness.

---

## 4. CORPUS-C — synthetic and adversarial counterexamples

**Status: none exist. Permitted only when explicitly labelled synthetic.**

These are test cases. They are not historical evidence and must never be
reported at a rate that implies frequency.

The owner's brief names thirteen cases to design for. They are specified here
and implemented nowhere yet; none is a 6V-PREP deliverable beyond this list.

| ID    | Fixture                            | What it must break                                                     |
| ----- | ---------------------------------- | ---------------------------------------------------------------------- |
| SC-01 | outdated user preference           | A superseded preference still selected by context ranking              |
| SC-02 | conflicting active rules           | Two active assets that cannot both be obeyed                           |
| SC-03 | stale agent cursor                 | An agent acting on a superseded ledger position                        |
| SC-04 | incorrect summary                  | A derived summary that contradicts its own evidence                    |
| SC-05 | wrong candidate asset              | A candidate whose `derivedFrom` does not support its `body`            |
| SC-06 | delayed external success           | Success arriving after `evaluateBy` — must stay a timing residual      |
| SC-07 | verifier disagreement              | Two verifiers returning different outcomes for one expectation         |
| SC-08 | invalid provenance                 | A `derivedFrom` reference that does not resolve                        |
| SC-09 | duplicated evidence                | One episode counted twice as independent                               |
| SC-10 | context self-reinforcement         | An asset whose only support is that it was exposed                     |
| SC-11 | user goal change mid-task          | A plan that continues past the goal it was built for                   |
| SC-12 | obsolete workflow                  | A workflow asset that still runs after the rule it encodes was retired |
| SC-13 | two agents, incompatible proposals | Concurrent proposals that cannot both be applied                       |

**Relationship to existing tests.** `SC-06`, `SC-08`, `SC-09` and `SC-10` are
already covered by the frozen suites: `tests/replay/async-02` is the delayed
success, provenance resolution is asserted in `phase4-assets`, and exposure
exclusion is asserted in `tests/unit/assets.test.ts`. The remaining nine have no
equivalent. `SC-03` partially overlaps `tests/regression/inc-001-regressions.test.ts`
"agent cursor integrity", which covers an _impossible_ cursor but not a _stale
but valid_ one — the distinction C3 exists to test.

---

## 5. Conclusions required by the owner's brief section 25

1. **What real internal material already exists?** I-02 in full (INC-001, the
   strongest item); I-01 as project artefacts including one substantial written
   statement of the author's own provenance discipline; I-03 as 294 derived
   pattern files with an empty source ledger; I-04 as named-and-uninspected
   candidates.
2. **What is still missing?** Every turn-level record of the art-production
   chain, the Production Card artefacts, the rejection and correction turns, and
   the skip-the-card counterexample. Also missing: any chat export at all.
3. **What external benchmarks are useful?** Named, with the caveat that every
   licence below is reported and unverified. **L1:** KUQ (MIT, ~50/50
   known/unknown) is the cheapest honest abstention test; LongMemEval's
   abstention slice adds a dialogue-shaped probe. **L2:** SWE-rebench V1
   (CC BY 4.0, execution-verified fail-to-pass tests, prebuilt images) is the
   best value-per-setup-cost, and SWE-smith's _injected_ bugs give a known root
   cause by construction. **L3:** Memora/FAMA (penalises reuse of invalidated
   memory) and MemoryAgentBench FactConsolidation are the on-target ones.
   **L4:** Who&When and MAST's taxonomy.
4. **Which benchmark claims cannot generalise?** Resolution-rate scores;
   retrieval-accuracy scores; anything judged by an LLM when the project needs
   an execution-based verifier; and single-run computer-use numbers, whose
   variance is reported to be dominated by data draw rather than by the subject.
   The structural reason is in §2.6 — no dataset in this scan contains a
   registered expectation with a verifier, or a reflection decision with its
   budget.
5. **Which datasets are too large, expensive or misaligned?** LongMemEval-V2
   (115M-token haystacks) and BEAM's 1M/10M tiers on size; OSWorld and
   WindowsAgentArena on setup cost and variance; AML, which publishes no data at
   all; and — regardless of scientific fit — every dataset whose licence is
   NonCommercial, ShareAlike, NoDerivatives or unverified, because this
   repository is MIT and public.
6. **Which failure trajectories are most valuable?** **CUA Debugger
   Trajectories** first: it is the only corpus carrying failure + root-cause
   step + grounded free-text evidence + a suggested correction + annotation
   confidence, with a companion paper that re-executes the repair. **TRAIL**
   second, for its OpenTelemetry step-level error spans. **LongRCA Bench** third
   for genuinely long-horizon natural failures, licence permitting.
7. **Which material can be processed in parallel?** I-01 (artefacts) and I-03
   (patterns against the promotion gate) share no state and can run
   concurrently. CORPUS-E scanning is independent of both and is now complete.
   CORPUS-I is strictly sequential with I-01c, which is blocked on the author.

---

## 6. What would falsify this manifest

- A chat export for the I-01 chain turning up on the workstation or a service —
  it would move I-01c from MISSING to PARTIAL and change Golden Fixture 01's
  status from `WAITING_FOR_AUTHOR_SOURCE` to an acquisition task.
- Any of the I-04 candidates turning out to contain a repeated workflow whose
  rule was revised — it would give CORPUS-I a second complete turn-level chain.
- The generation-1 `.events` directory turning out to be empty on this
  workstation but populated elsewhere — it would change I-03 from DERIVED to
  PRIMARY and make the 294 patterns checkable against their own source.
