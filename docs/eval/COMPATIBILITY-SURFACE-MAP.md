# Compatibility Surface Map

**Date:** 2026-09-18
**Authority:** owner's Phase 6V brief §8 (`Compatibility Surface Map`) and §9
(`Compatibility 本轮边界`).
**Evidence:** [`_COMPAT-PROBE-RAW.md`](_COMPAT-PROBE-RAW.md), an empirical probe run
on this host on 2026-09-18, plus CI artifacts and source inspection.
**Status:** first pass. §9 is explicit that this phase is 「**不是 Compatibility
Completion**」 — the output is a _map_, not a supported-platform claim.

---

## 0. How to read this

§9 requires six categories: 已验证 / 未验证 / 已知失败 / Release blocker / Later
support / intentionally unsupported. The statuses below are those, plus
`UNKNOWN` for the cases where not even that much is established.

**One fact governs the whole document and is repeated in §8.3 rather than
implied everywhere:** every probe result below is **Node 24.15.0 on Windows 11**.
Node 22.13.0 is not installed on this host and no probe could use it. CI has run
the gate on 22.13.0 on both platforms, and that is engineering evidence, not
experiment evidence.

**A second fact, which is a defect and is recorded as
[BP-065](../断点记录.md):** `scripts/assert-runtime-pins.mjs` cannot fail on a
wrong Node version — its upper-bound regex does not parse `<23`. Observed: it
printed `PASS` while running on 24.15.0, outside the pinned range. So the map
below is not merely unmeasured; **the one check that claims to measure it is
broken.**

## 8.1 Operating system

| Platform               | Status                                                                      | Basis                           |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| Windows 11 (this host) | **Verified** — gate PASS, 12 stages, ~124 s                                 | `test-results/gate-result.json` |
| Ubuntu (CI)            | **Verified for the gate only** — PASS, 119 s                                | CI artifacts on `6b7dcdc33804`  |
| Windows (CI)           | **Verified for the gate only** — PASS, 243 s                                | same                            |
| macOS                  | **Not tested.** Not merely unsupported — no decision has been made about it | —                               |

Path semantics, permission model, file locking, process signals, case
sensitivity and newline handling differ across all three and only the first two
have been exercised. `BP-061` is what an untested platform difference looks like
when it lands: a guard that fails open on Linux and cannot fail on Windows.

## 8.2 CPU architecture

| Arch  | Status                                       |
| ----- | -------------------------------------------- |
| x64   | **Verified** — this host and both CI runners |
| arm64 | **UNKNOWN**                                  |

`UNKNOWN` rather than `NOT TESTED` because it is not established whether anything
in the build would behave differently. `node:sqlite` is a native module and
`better-sqlite3` was abandoned in `BP-001` partly over native-build chains, so
the question is real rather than formal.

## 8.3 Runtime

| Item                                          | Status                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Node 22.13.0 (canonical) — **gate**           | **Verified** on Ubuntu and Windows in CI                                                        |
| Node 22.13.0 — **any experiment**             | **Not tested.** No 6V run has executed on it                                                    |
| Node 22.13.0 — **installed on this host**     | **Not installed.** No `nvm`, `fnm`, `volta` or `nvs`; only `C:\Program Files\nodejs` at 24.15.0 |
| Node 24.x                                     | **Verified** for the gate locally; **outside the declared range**                               |
| `node:sqlite` without `--experimental-sqlite` | Verified on 24.15.0 only                                                                        |
| **The pin check itself**                      | **Known failure — `BP-065`.** The upper bound never fires                                       |

**Consequence.** "Run 6V-0 again on the pinned runtime" — the cheapest outstanding
item in the phase — **cannot be done on this machine.** It needs CI, a second
machine, or an installed runtime, and §K forbids installing runtimes for
unrelated convenience.

## 8.4 Package / install surface

| Item                                                             | Status                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| pnpm 11.19.0, workspace-internal                                 | **Verified**                                                         |
| Everything else (npm, npx, standalone binary, installer, Docker) | **Intentionally unsupported** — §14 defers it to Release Engineering |

All four packages are `private: true` and depend on `workspace:*`. There is no
install story and no decision about one.

## 8.5 Shell

| Item                                      | Status                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scripts/gate.mjs` spawns without a shell | **Verified by source** — `shell: false`, argv arrays                                         |
| Metacharacter scan of all scripts         | Exactly one construct, `&&`, in 6 scripts. No pipes, `$(`, backticks or single-quote quoting |
| `&&` under `cmd.exe` / PowerShell 7+      | **Not tested** — stated from general knowledge, not measured                                 |
| `&&` under PowerShell 5.1                 | **Hazard, not tested.** PS 5.1 does not support `&&`                                         |
| git-bash                                  | The shell the project's own evidence was produced under                                      |

`script-shell` is unset, so the default host shell applies. This is a **Release
blocker for any documentation that tells a user to run `pnpm verify`**, and it
is not a defect today because no such document exists.

Related, from the probe: `icacls /deny` is rewritten by git-bash's path
conversion unless `MSYS_NO_PATHCONV=1` is set — a real hazard for any
instruction that tells a user to run it.

## 8.6 Filesystem / storage

| Item                                              | Status                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite via `node:sqlite`, WAL, `synchronous=FULL` | **Verified** — the substrate of every run                                                                                                                                                                                                                                                       |
| Backup / restore                                  | **Verified** in Phase 4; `BP-047` is a fixed defect there                                                                                                                                                                                                                                       |
| CJK + space path round-trip                       | **Verified** on this host                                                                                                                                                                                                                                                                       |
| Long paths                                        | **Verified to 402 characters** with plain `node:fs` — while the registry reads `LongPathsEnabled = 0x0`. **The mechanism was not isolated**, and behaviour beyond 402 chars is `NOT TESTED`                                                                                                     |
| Read-only directory                               | **Verified.** `icacls /deny` produces `EPERM` (errno −4048, syscall `open`) from `node:fs`, and `ERR_SQLITE_ERROR: unable to open database file` from `node:sqlite` — which does **not** surface the underlying errno, and gives the same class whether or not the database file already exists |
| `chmod -w`                                        | **Known failure / no-op on Windows.** The write still succeeded. Any instruction using `chmod` to make a directory read-only is wrong here                                                                                                                                                      |
| Network drive                                     | **Not tested**                                                                                                                                                                                                                                                                                  |

## 8.7 Locale / encoding

| Item                        | Status                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTF-8                       | **Verified**                                                                                                                                                                              |
| Chinese paths and filenames | **Verified** — round-trip through `node:fs` and `node:sqlite`                                                                                                                             |
| Mixed-language filenames    | **Verified**                                                                                                                                                                              |
| Japanese paths              | **Not tested**                                                                                                                                                                            |
| Timezone                    | `Asia/Shanghai` on this host; recorded in the corpus export. Nothing is timezone-sensitive in the runtime beyond canonical UTC timestamps                                                 |
| Console encoding            | **Known pitfall.** Windows consoles render UTF-8 Chinese as mojibake through some tools; the probe hit it and the repository's own Chinese documentation is affected by whatever reads it |

## 8.8 CLI / daemon

| Item                   | Status                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| Embedded CLI           | **Verified** — `smoke:cli` is a gate stage                          |
| Daemon                 | **Verified** — `smoke:daemon` is a gate stage                       |
| Writer ownership lock  | **Verified** — Phase 3.5 concurrent-writer scenario                 |
| Stale lock recovery    | **Not tested** — no test exercises a lock file with no live process |
| Crash recovery         | **Verified** — `phase1:crash`                                       |
| Multi-process boundary | **Verified** at C0–C2; C3/C4 out of scope by §19                    |

The daemon's stream contract is worth naming here because `BP-063` was about it:
the machine document goes to **stderr** on the refusal path, which is the same
stream Node writes `ExperimentalWarning` on. Order is not guaranteed and the
reader no longer assumes it.

## 8.9 Providers / models

**This is the area where the gap between a claim and its evidence is largest.**

| Item                          | Status                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-neutral **contract** | **Verified by test** — the execution/error and observability boundary suites prove vendor exception types, response shapes and telemetry fields cannot become core semantics                                      |
| Provider **coverage**         | **One provider, one model, one day.** 6V-0's own document calls this weak                                                                                                                                         |
| A second provider             | **Not tested**                                                                                                                                                                                                    |
| A second model, one provider  | **Not tested** — 6V-2X's minimum                                                                                                                                                                                  |
| Supported-provider list       | **Does not exist.** §15 requires one before a Release Candidate                                                                                                                                                   |
| Error taxonomy sufficiency    | **Partially verified.** Nine of nine landed in the twelve kinds; `unknown_external_failure` was never reached; `transient_provider_failure` and `permanent_provider_failure` were never exercised against reality |
| Quota / config kinds          | **Untested rather than closed** — the OSS scan found OpenHands' frozen taxonomy carries `QUOTA` and `CONFIG`, which Praxis does not, and no run has produced either                                               |

**The brief's own warning applies verbatim:** 「不得宣称「provider-neutral」=
「所有 provider 已验证」」. Neutrality is a statement about the _boundary_, and it
is tested. Coverage is a statement about _subjects_, and it is one data point.

## 8.10 Tool / protocol interfaces

| Item                                          | Status                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ModelAdapter`                                | **Verified** against a live provider (6V-0)                                        |
| `ToolAdapter`                                 | **Not tested against a real tool.** The contract exists; no real tool adapter does |
| MCP / GitHub / filesystem / external verifier | **Not built.** §14 defers; Phase 6V only surveys                                   |

## 8.11 Network environment

| Item                                              | Status                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does any mandatory gate stage need the network?   | **No** — verified by source inspection of every stage. The only HTTP client in the repository is `tests/validation/validation-provider-adapter.ts`, reachable only via `validate:6v0`, which is not in `verify:chain` and self-skips without a credential |
| Verified with the network **physically disabled** | **Not tested.** The answer above is a claim about the code                                                                                                                                                                                                |
| Timeout / proxy / offline / partial outage        | **Not tested**                                                                                                                                                                                                                                            |
| Rate limit                                        | **Verified as handled** — injected 429 classified correctly; never observed from a real provider                                                                                                                                                          |

## 8.12 Permissions / sandbox

| Item                  | Status                                       |
| --------------------- | -------------------------------------------- |
| Normal user           | **Verified**                                 |
| Restricted directory  | **Verified** — see §8.6                      |
| Missing permission    | **Verified** for `node:fs` and `node:sqlite` |
| Sandboxed environment | **Not tested**                               |

## 8.13 CI

| Item                                | Status                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| Windows + Ubuntu, Node 22.13.0      | **Verified** on `6b7dcdc33804`; artifact-verified          |
| macOS runner                        | **Not present.** Not "unsupported" — nobody has decided    |
| arm64 runner                        | **Not present**                                            |
| Gate artifact uploaded per platform | **Verified** — `gate-result-ubuntu`, `gate-result-windows` |

## 8.14 Git / repository

| Item              | Status                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Clean worktree    | **Verified**                                                                                                                    |
| Dirty worktree    | **Detected and recorded** — the manifest carries `runtimeDirty`, and 6V-0's own record says the run was dirty                   |
| Branch divergence | **Verified.** Branch `docs/phase6v-prep`, 39 commits ahead of `origin/main` (`15f6e2f`); the remote was reachable on 2026-09-18 |
| Detached HEAD     | **Not tested**                                                                                                                  |
| No remote         | **Not tested**                                                                                                                  |
| Large repository  | **Not tested**                                                                                                                  |
| Line endings      | `.gitattributes` is `* text=auto eol=lf` with two deliberate `-text` opt-outs (`fixtures/legacy/**`, `tests/replay/*.ndjson`)   |

---

## Summary

| Category                      | Count | Items                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified**                  | 21    | the gate on both OSes; x64; `node:sqlite`; CJK paths; long paths to 402; read-only via `icacls`; CLI; daemon; locks; crash recovery; UTF-8; provider-neutral _contract_; `ModelAdapter`; network-independent gate; normal and restricted permissions; CI matrix; artifact upload; clean/dirty git; divergence |
| **Partially verified**        | 6     | error-taxonomy sufficiency; multi-process boundary; rate limiting; backup/restore; line endings; long paths beyond 402                                                                                                                                                                                        |
| **Not tested**                | 19    | macOS; all experiments on the pinned runtime; Japanese paths; network drive; stale lock; second provider; second model; `ToolAdapter`; MCP; offline/proxy/timeouts; sandbox; detached HEAD; no-remote; large repository; `&&` under PowerShell; network physically disabled; arm64 runner; macOS runner       |
| **Known failure**             | 3     | **`BP-065`** — the pin check cannot fail; **`chmod -w`** is a no-op on Windows; git-bash rewrites `icacls` arguments                                                                                                                                                                                          |
| **UNKNOWN**                   | 1     | arm64                                                                                                                                                                                                                                                                                                         |
| **Intentionally unsupported** | 1     | packaging and distribution surface (§14)                                                                                                                                                                                                                                                                      |
| **Release blocker**           | 2     | no supported-platform matrix can be declared; `pnpm verify` shell-sensitivity is undocumented and unmeasured                                                                                                                                                                                                  |

**No item in the "Not tested" list is a supported platform.** §9's instruction is
explicit and this document follows it: 「不要为了 Compatibility Surface Map 突然
实现 macOS 完整支持、arm64、Docker、Electron、installers、auto update、plugin
marketplace、every provider」.

## What this map is not

It is not a support policy. It records what has been observed, and the three
known failures are all in the _checking_ apparatus rather than in the runtime —
`BP-065` most of all, because it is the check whose job is to notice exactly this
kind of gap.
