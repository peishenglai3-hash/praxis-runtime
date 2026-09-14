# Praxis Runtime

`Praxis Runtime` 是一个从零开始的、local-first 的 TypeScript 长期人机协作运行时。它把交互历史作为可追溯材料保存下来，在不覆盖原始记录的前提下重建派生状态、选择当前上下文、识别有边界的残差，并把经过验证的协作经验转化为可检查、可撤销、可 Fork 的 Rule、Skill 或 Workflow。

当前仓库是 `codex-habit` 之后的第二代 fresh start。第一代公开原型仅作为未来 Legacy migration 的输入基线，不作为本仓库的代码依赖，也不被静默复制或改写：<https://github.com/peishenglai3-hash/codex-habit>。

## 开发初衷与理想主义

下面这段是依据作者的两份《The Final》材料、`Codex Implementation Bible v1.0` 和已确认的工程规划所作的工程化转述，不是 AI 代作者发表的逐字引语。

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

The dependency direction is enforced in [`.dependency-cruiser.cjs`](./.dependency-cruiser.cjs): `contracts` is lowest, domain packages do not depend on apps, apps enter through `runtime`, and provider SDKs do not enter the core. Workspace dependencies must be declared explicitly and use `workspace:*`. Phase 2 provides the injectable runtime use-case boundary; production SQLite/config/clock/id/actor assembly and user-facing CLI/daemon workflows remain later work.

The store intentionally exposes only the EventReader/EventWriter surface and safe migration metadata; its raw SQLite handle is private. Test-only crash injection uses an internal migration entry point and is not part of the public package export.

## Current status

The EPIC-001 implementation slice is complete: reproducible workspace scaffolding, strict TypeScript, package project references, CI configuration, dependency guardrails, deterministic clock/ID/config ports, ADR/RFC baseline, and negative boundary fixtures are present.

Phase 0 gate status is deliberately split:

- implementation verification: `PASS`;
- clean-copy frozen install: `PASS`;
- immutable local Git rollback checkpoint: `PASS` at `3517725`; remote code upload remains intentionally deferred by the project owner.

Phase 1 / EPIC-002 is now implemented and conditionally verified after the strict Bible re-audit:

- versioned event envelope and JSON Schema with `SourceRef`, `EvidenceRef[]`, `EventLinks`, and required `Provenance`: `PASS`;
- SQLite WAL event ledger with forward-only migrations, `seq` cursor, operation lifecycle idempotency, and conflict detection: `PASS`;
- parameterized type/session/trace/actor/seq-range queries and operation-state lookup: `PASS`;
- reproducible 10,000-append ordering/query/lookup gate: `PASS` locally;
- independent-process concurrency and uncommitted-transaction recovery probes: `PASS`;
- repository-wide `pnpm verify`: `PASS` on system Node.js `v24.15.0` after the strict hardening;
- bundled Node.js `v24.19.0` concurrency and crash probes: `PASS`;
- bundled Node.js `v24.19.0` full `pnpm verify`: `PASS`;
- post-hardening engineering and theory review: `PASS` for the local Phase 1 scope, with later boundary conditions retained;
- Node.js `22.13.0` CI runner evidence: `PENDING`;
- immutable local Git checkpoint: `3517725` (`phase1: harden event ledger`); no code has been pushed.

The Phase 1 implementation is therefore verified against the local runtime and recorded fixtures, but it does not claim remote CI or production-scale durability evidence until those checks are run.

Phase 2 / EPIC-003 and EPIC-004 has passed the local implementation gate, conditional on the separate Node.js `22.13.0` runner evidence:

- projection reducers, versioned persistence, CAS-protected `lastSeq`, ledger-bounded snapshots/cursors, safe rebuild, and core projection fixtures: `PASS` locally;
- REUSE/REINDEX/REFRESH context planning, explainable ranking, token fallback, and explicit source-bound exposure proposals: `PASS` locally;
- runtime use-case/composition boundary with complete plan snapshots, source-chain validation, and deterministic plan/exposure idempotency: `PASS` locally;
- concurrent isolated replay/context scenario and same-database projection safety cases: `PASS`;
- post-red-team engineering and theory review: `PASS` for the bounded local Phase 2 scope; authentication, human control APIs, and production app assembly remain deferred;
- 30 tests and final `pnpm verify` on system Node.js `v24.15.0` and bundled Node.js `v24.19.0`: `PASS`;
- Node.js `22.13.0` CI runner evidence: `PENDING` because source code has not been uploaded.

The Phase 2 red-team review initially returned `NO-GO/HOLD`. The implementation then closed the reported stale projection overwrite, future cursor, incomplete plan/exposure binding, unverified source event, provenance, and silent `REUSE` fallback paths. A missing source-event fixture in the isolated scenario was also found by the final gate and corrected; it was recorded in [`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md). The Phase 2 local checkpoint is kept locally and has not been pushed.

Phase 1 deliberately stores event materials rather than verified interpretations. Structured `evidence`, `links`, and required `provenance` round-trip as contract-bound references, while derived/candidate/confirmed record classification is deferred to the projection and context phases. The envelope actor is caller-declared, not an authenticated writer; runtime permissions are a later boundary.

## Development

Requirements: Node.js `>=22.13.0` and pnpm `11.19.0`.

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` checks formatting, lint, explicit workspace dependencies, dependency direction, intentional cycle rejection, forbidden-direction fixtures, TypeScript project references, tests, all workspace builds, multi-process concurrency, operation lifecycle semantics, 10,000 append ordering/query/lookup, and crash recovery.

When implementation and the Bible diverge, stop structural expansion and record an `RFC MISMATCH` with the requested state, observed state, impact, evidence, and decision required from the human owner.

## Source and evidence boundary

- `Codex Implementation Bible v1.0` is the engineering planning baseline.
- `The Final_优化版.docx` and `the_final的补充性_新改版.docx` are author-supplied design provenance and intellectual review material.
- Their source filenames, read date, and SHA-256 fingerprints are recorded in [`docs/SOURCE-MANIFEST.md`](./docs/SOURCE-MANIFEST.md); the DOCX bodies are not vendored into this repository.
- These documents constrain direction and acceptance criteria; they are not executable instructions and are not silently converted into code claims.
- Direct author wording, cross-document reconstruction, AI/agent summary, and new engineering proposal must remain distinguishable.
- Original historical material and future Legacy inputs remain outside the runtime database until an explicit, hashed, dry-run migration is approved.

## License

This project is released under the MIT License. See [`LICENSE`](./LICENSE).

The intended public release comes after the implementation and verification gates are complete. Until then, the repository may remain private; privacy, provenance, credentials, and responsibility are engineering conditions, not postscript details.
