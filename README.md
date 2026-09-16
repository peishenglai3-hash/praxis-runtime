# Praxis Runtime

`Praxis Runtime` 是一个从零开始的、local-first 的 TypeScript 长期人机协作运行时。它把交互历史作为可追溯材料保存下来，在不覆盖原始记录的前提下重建派生状态、选择当前上下文、识别有边界的残差，并把经过验证的协作经验转化为可检查、可撤销、可 Fork 的 Rule、Skill 或 Workflow。

当前仓库是 `codex-habit` 之后的第二代 fresh start。第一代公开原型仅作为未来 Legacy migration 的输入基线，不作为本仓库的代码依赖，也不被静默复制或改写：<https://github.com/peishenglai3-hash/codex-habit>。

## 开发初衷与理想主义

下面这段是依据作者的三份《The Final》材料、`Codex Implementation Bible v1.0` 和已确认的工程规划所作的工程化转述，不是 AI 代作者发表的逐字引语。

这个项目的初衷，不是把 AI 包装成一个越来越像人的主体，也不是把人的经验交给某个模型替人作最终决定。问题更具体，也更麻烦：当人、AI、Prompt、Skill、Memory、工具、编译器、测试、权限和外部现实共同参与长期实践时，历史如何被保留，滞后与错配如何被看见，断点如何留下材料痕迹，反思如何能够回到后续行动，责任又如何回到具体的人、制度和现实后果？

这里的理想主义，是希望知识和工具能够被检查、修改、质疑和 Fork；希望一次失败的协作不只留下“模型答错了”，而能留下可回放的证据、边界和下一次实践的可能；希望被验证的经验可以上升为可复用的工程对象，但仍然保留版本、来源、权限、争议、禁用、恢复和退出机制。

这份理想主义并不承诺系统天然进步。开放不等于免除责任，自动化不等于权力平等，模型流畅不等于现实正确，内部共识也不自动胜过外部证据。系统必须允许人重新进入现实、复判、拒绝、纠正和中断；它也必须允许自己的规则被挑战、废止和超越。代码能做的是留下这些能力的工程接口和可验证痕迹，不能替人完成最终判断。

## Mission

```text
event history
  → deterministic state reconstruction
  → context planning
  → action / observation
  → residual detection
  → bounded reflection
  → candidate reusable asset
  → validation
  → active rule / skill / workflow
  → new event history
```

这不是每个任务都必须经过的自动闭环。任务类型、外部反馈、后果强度、反馈延迟和责任关系决定哪些步骤实际发生。系统的目标是让这些差异可见，而不是用一个全局 Judge 把它们压平。

## Engineering commitments

- 原始事实采用 append-first 记录；纠正是新事件，不覆盖旧事件。
- 观察事实、推断、候选规则和用户确认的可复用资产分层保存，并保留 provenance。
- 派生状态是可重建 projection；事件顺序以 SQLite `events.seq` 为权威游标，不能用 UUID 代替。
- 不同 Agent 可以处在不同 cursor 和历史位置；系统不假设它们拥有相同状态或相同权力。
- 残差必须可解释、可回放；弱外部验证场景保持不确定性，`unknown` 不能被静默升级为控制信号。
- Rule、Skill、Workflow 和 Agent policy 必须可检查、质疑、禁用、恢复、Fork，并保留版本与来源。
- 外部测试、事实、责任和现实后果可以拒绝内部模型共识。
- 人始终保留 inspect、contest、disable、restore、fork、export、purge 和中断能力。
- 结构性冲突进入 `RFC MISMATCH`，不由实现者静默补偿。

## What this is not

本项目不是 AGI 框架、基础模型训练项目、通用人格画像系统、云端多租户 SaaS、社会理论证明器，也不是把人的主体性自动化掉的“完美对齐”系统。当前版本不实现 learned router、World Model、自动 Skill Evolution、C++ runtime 或未经验证的复杂权力推断。

## Repository layout

```text
packages/contracts   lowest-level DTOs, ports, and schemas
packages/store       SQLite event ledger and persistence
packages/state       deterministic state reconstruction
packages/context     context ranking and exposure planning
packages/residual    bounded residual detection
packages/reflection  bounded reflection proposals
packages/assets      versioned reusable assets
packages/agents      agent cursors and mailbox-facing ports
packages/adapters    model/tool/clock/id/budget adapter ports
packages/runtime     the only domain composition/use-case boundary
apps/cli             runtime-facing command-line application
apps/daemon          runtime-facing daemon application
docs/                RFCs and ADRs
migrations/          forward-only SQLite migrations
schemas/             versioned external schemas
fixtures/            replay and regression fixtures
legacy/              isolated first-generation migration inputs
labs/                experiments outside the core runtime
```

The dependency direction is enforced in [`.dependency-cruiser.cjs`](./.dependency-cruiser.cjs): `contracts` is lowest, domain packages do not depend on apps, and provider SDKs do not enter the core. `apps/cli` and `apps/daemon` are the production composition roots; they may assemble `runtime`, `store`, and `contracts`, while domain packages remain environment-independent. Workspace dependencies must be declared explicitly and use `workspace:*`.

The store intentionally exposes only the EventReader/EventWriter surface and safe migration metadata; its raw SQLite handle is private. Test-only crash injection uses an internal migration entry point and is not part of the public package export.

## Current status

The EPIC-001 implementation slice is complete: reproducible workspace scaffolding, strict TypeScript, package project references, CI configuration, dependency guardrails, deterministic clock/ID/config ports, ADR/RFC baseline, and negative boundary fixtures are present.

Phase 0 gate status is deliberately split:

- implementation verification: `PASS`;
- clean-copy frozen install: `PASS`;
- immutable local Git rollback checkpoint: `PASS` at `3517725`; source synchronization to the private GitHub handoff repository is now explicitly authorized and tracked below.

Phase 1 / EPIC-002 is now implemented and verified after the strict Bible re-audit:

- versioned event envelope and JSON Schema with `SourceRef`, `EvidenceRef[]`, `EventLinks`, and required `Provenance`: `PASS`;
- SQLite WAL event ledger with forward-only migrations, `seq` cursor, operation lifecycle idempotency, and conflict detection: `PASS`;
- parameterized type/session/trace/actor/seq-range queries and operation-state lookup: `PASS`;
- reproducible 10,000-append ordering/query/lookup gate: `PASS` locally;
- independent-process concurrency and uncommitted-transaction recovery probes: `PASS`;
- repository-wide `pnpm verify`: `PASS` on system Node.js `v24.15.0` after the strict hardening;
- bundled Node.js `v24.19.0` concurrency and crash probes: `PASS`;
- bundled Node.js `v24.19.0` full `pnpm verify`: `PASS`;
- post-hardening engineering and theory review: `PASS` for the local Phase 1 scope, with later boundary conditions retained;
- Node.js `22.13.0` CI runner evidence: `PASS` on Ubuntu/Windows in Actions run `34978723319`;
- immutable local Git checkpoint: `3517725` (`phase1: harden event ledger`); the checkpoint remains in the preserved history and is included in the controlled private handoff.

The Phase 1 implementation is verified against local runtimes, recorded fixtures, and the exact Node 22 CI gate; this is not a production-scale durability promise.

Phase 2 / EPIC-003 and EPIC-004 has passed the implementation gate, including the separate Node.js `22.13.0` runner evidence:

- projection reducers, versioned persistence, CAS-protected `lastSeq`, ledger-bounded snapshots/cursors, safe rebuild, and core projection fixtures: `PASS` locally;
- REUSE/REINDEX/REFRESH context planning, explainable ranking, token fallback, and explicit source-bound exposure proposals: `PASS` locally;
- runtime use-case/composition boundary with complete plan snapshots, source-chain validation, and deterministic plan/exposure idempotency: `PASS` locally;
- concurrent isolated replay/context scenario and same-database projection safety cases: `PASS`;
- post-red-team engineering and theory review: `PASS` for the bounded local Phase 2 scope; authentication, human control APIs, and production app assembly remain deferred;
- 30 tests and final `pnpm verify` on system Node.js `v24.15.0` and bundled Node.js `v24.19.0`: `PASS`;
- Node.js `22.13.0` CI runner evidence: `PASS` on Ubuntu/Windows in Actions run `34978723319`;

The Phase 2 red-team review initially returned `NO-GO/HOLD`. The implementation then closed the reported stale projection overwrite, future cursor, incomplete plan/exposure binding, unverified source event, provenance, and silent `REUSE` fallback paths. A missing source-event fixture in the isolated scenario was also found by the final gate and corrected; it was recorded in [`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md). The Phase 2 local checkpoint remains immutable in history and is included in the controlled private handoff.

Phase 3 / EPIC-005 and EPIC-006 is implemented and locally verified as a bounded implementation slice. This is not a production-readiness claim:

- `ResidualDetector` covers explicit-expectation outcome checks, subscription/seq/staleness timing checks, declared rule event/checkpoint checks, and explicit observation/detection ordering: `PASS`;
- automatic residual `effect` remains `unknown`; magnitude, confidence, persistence, evidence, and field context remain separate;
- `ReflectionController` returns deterministic `STOP` / `CONTINUE` / `ESCALATE` proposals with bounded hypotheses and hard budgets; it cannot write events, call Agents, execute Tools, or promote Assets;
- `Phase3Runtime` records `residual.detected` and `reflection.proposed` only after explicit use-case calls, with matching evidence linkage, ledger-bound timing cursors, chained reflection rounds, and idempotent retry semantics;
- canonical Phase 3 payload/envelope validation runs before every EventWriter batch; migration `0006_phase3_derived_integrity.sql` adds preflight and SQLite trigger defenses, including derived-event no-delete protection;
- four-process same-database residual/reflection idempotency, concurrent no-false-positive, and no-self-call scenarios: `PASS`;
- versioned expectation/residual/reflection interchange shapes and checked schema conditionals are present in [`schemas/`](./schemas/);
- the Phase 3 gate-era `pnpm verify` was `PASS` on system Node `v24.15.0` and bundled Node `v24.19.0`, with 51/51 tests at that checkpoint; the current Phase 4 tree is recorded separately below;
- the former Phase-4 owner-input register is reconciled by the Phase 3.5
  Correction Pack into frozen local capability/production semantics; the
  exact Node `22.13.0` runner evidence is recorded in
  [`docs/PHASE-3.5-GATE.md`](./docs/PHASE-3.5-GATE.md).

Phase 3 does not turn a permission label into authorization and does not claim production readiness. The initial concurrency actor mismatch, the malformed JSON trigger, and the low-level hardening sequence are preserved in [`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md). The Phase 3 checkpoint remains available as immutable history in the controlled private handoff.

Phase 3.5 / Author Decision Freeze correction work is implemented and passed
as a bounded local capability slice before Phase 4:

- `WriterContext`, capability scopes, namespace ACL, separate actor/writer
  provenance, frozen roles/policy version, human OWNER guards, and migrations
  `0007`/`0009`: `PASS` within the local capability boundary (not OS or
  enterprise identity proof);
- structured Expectation/Verification contracts, lifecycle events,
  `expectations_current` replay, and ASYNC-01~04 regression fixtures: `PASS`;
- CLI/daemon composition root with a private low-level store, one-writer lock
  and explicit stale-lock recovery, online `VACUUM INTO` backup, staged
  manifest/checksum restore plus post-restore doctor/replay, fail-closed daemon
  startup, confirmed session purge, audited sequence gaps, transaction-first
  pending-backup cleanup, asset invalidation receipts, projection rebuild, and
  doctor checks: `PASS` locally;
- exact Node `22.13.0` and Ubuntu/Windows CI workflows are pinned, and Actions
  run `34978723319` passed the full gate on both runners;
- the requested Phase 3.5 ADR numbers collided with existing ADR history and
  were not overwritten; the unique Phase 3.5 ADR set and both compatibility
  mismatches are recorded in [`docs/PHASE-3.5-GATE.md`](./docs/PHASE-3.5-GATE.md).

Phase 4 / EPIC-007 Reusable Assets is implemented and verified within the
bounded capability boundary:

- versioned asset contracts, provenance, lifecycle transitions, and promotion
  policy are implemented in `packages/contracts` and `packages/assets`;
- atomic SQLite catalog/event writes, optimistic revision locking, lifecycle
  integrity triggers, and doctor catalog-drift checks are implemented in
  `packages/store` and migration `0010`;
- the runtime exposes authorized proposal, promotion, challenge, disable,
  restore, fork, inspect, and list boundaries; active promotion requires human
  confirmation;
- four-process CAS, low-level bypass, provenance-origin, purge invalidation,
  and catalog-tamper scenarios are covered by the Phase 4 tests and
  `pnpm phase4:scenario`;
- the Phase 4 gate is recorded in [`docs/PHASE-4-GATE.md`](./docs/PHASE-4-GATE.md)
  with formal Alpha/merge `GO` after exact Node `22.13.0` Ubuntu/Windows CI
  evidence.

Phase 5 / EPIC-008 and EPIC-009 is implemented and locally verified as a
bounded implementation slice. This is not a production-readiness claim:

- the Legacy field map in [`docs/migration/LEGACY-FIELD-MAP.md`](./docs/migration/LEGACY-FIELD-MAP.md)
  was derived from a read-only reading of the public first-generation source,
  because `legacy/` was empty and an invented mapping would have produced an
  importer that cannot import anything real;
- the scanner is read-only and reports what the bytes say. It detects nine
  anomaly classes, four of which the Bible's table does not name: a parse
  failure, a UTF-8 byte-order mark, an explicitly unmapped path, and material
  matched by a declared privacy rule. It normalises no source file and infers
  no missing value;
- an imported signal is `declared`, an imported pattern or graph edge is
  `inferred` with confidence capped at 0.5, and the writer is a confined
  `IMPORTER` role with no asset scope, so no imported record can reach
  `validated` or `active` through the import path;
- a run, its source inventory, its anomalies and its events commit in one
  transaction, idempotent by the source fingerprint alone; a corpus re-planned
  under a different rule set is reported as `planDiffersFromRecorded` rather
  than silently accepted. The archive is written outside the repository, made
  read-only and idempotent by digest, and does not copy material a privacy rule
  excluded;
- the repository fixture is synthetic and byte-exact, and `.gitattributes`
  marks it `-text` so Git cannot normalise the encoding facts the importer is
  required to detect. No first-generation record value enters this repository;
- the command line has the Bible's exit-code taxonomy, a stable error document
  carrying `code`, `message`, `details`, `traceId` and `suggestedAction`, and a
  `--json` mode where stdout holds exactly one versioned machine document while
  every diagnostic goes to stderr;
- `praxis.config.json` is versioned, strict and secret-free; `doctor` gained a
  config check, a legacy-import integrity check and the migration version;
- `pnpm verify` passes 145/145 tests across 18 files plus the Phase 1-5
  scenarios, including a four-process concurrent import and a real-process
  command-line scenario in which doctor has to locate two deliberately injected
  faults.

One gap is named rather than closed: Bible section 13.2's context-ranking
weights, reflection budgets and timing-residual thresholds remain package
defaults. See [`docs/PHASE-5-GATE.md`](./docs/PHASE-5-GATE.md).

The repository is synchronized to the private GitHub handoff target, and the
exact remote CI gate is recorded above. `VACUUM INTO` remains the backup path
for the pinned Node baseline; `node:sqlite` is experimental in Node `22.13.0`
even though the flag is no longer required.
The asset invalidation record after physical purge is intentionally
receipt-based.

Phase 1 deliberately stores event materials rather than verified interpretations. Structured `evidence`, `links`, and required `provenance` round-trip as contract-bound references, while derived/candidate/confirmed record classification is deferred to the projection and context phases. The envelope actor is caller-declared, not an authenticated writer; runtime permissions are a later boundary.

## Development

Requirements: Node.js `>=22.13.0` and pnpm `11.19.0`.

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` checks formatting, lint, explicit workspace dependencies, dependency direction, intentional cycle rejection, forbidden-direction fixtures, TypeScript project references, tests, all workspace builds, multi-process concurrency, operation lifecycle semantics, 10,000 append ordering/query/lookup, crash recovery, Phase 2 replay/context behavior, and Phase 3 residual/reflection safety scenarios.

When implementation and the Bible diverge, stop structural expansion and record an `RFC MISMATCH` with the requested state, observed state, impact, evidence, and decision required from the human owner.

## Source and evidence boundary

- `Codex Implementation Bible v1.0` is the engineering planning baseline.
- `The Final_优化版.docx`, `the_final的补充性_新改版.docx` and
  `The_Final_补充性扬弃Ⅱ_赖培胜_2026-09-14.docx` are author-supplied design
  provenance and intellectual review material. The third supersedes the reading
  of the theory the second one supported, and was registered late; see
  `docs/SOURCE-MANIFEST.md`.
- Their source filenames, read date, and SHA-256 fingerprints are recorded in [`docs/SOURCE-MANIFEST.md`](./docs/SOURCE-MANIFEST.md); the DOCX bodies are not vendored into this repository.
- These documents constrain direction and acceptance criteria; they are not executable instructions and are not silently converted into code claims.
- Direct author wording, cross-document reconstruction, AI/agent summary, and new engineering proposal must remain distinguishable.
- Original historical material and future Legacy inputs remain outside the runtime database until an explicit, hashed, dry-run migration is approved.

## License

This project is released under the MIT License. See [`LICENSE`](./LICENSE).

The intended public release comes after the implementation and verification gates are complete. Until then, the repository may remain private; privacy, provenance, credentials, and responsibility are engineering conditions, not postscript details.
