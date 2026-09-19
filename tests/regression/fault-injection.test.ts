import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { parseScenario, ScenarioLoadError } from "../../evals/src/scenario.js";
import { ancestorDirectories } from "../../apps/cli/src/paths.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";
import type {
  EventEnvelope,
  WriterContext,
} from "../../packages/contracts/src/index.js";
import { permissionScopes } from "../../packages/contracts/src/index.js";

/**
 * Fault injection: the negative half of VF-01.
 *
 * [`FAILURE-FAMILIES.md`](../../docs/engineering/FAILURE-FAMILIES.md) records six
 * families across 65 breakpoints. This file exists because the brief's §3 is
 * explicit that the countermeasure is not more careful reading:
 *
 *   「对 Gate / Test Harness 加入 negative-control 测试；测试「错误系统是否能够
 *    稳定 FAIL」，而不仅是「正确系统是否 PASS」。」
 *
 * "Test the test." A check that has only ever been shown to pass has not been
 * shown to be capable of failing, and those are different claims. Every case
 * below plants a specific fault and asserts the check *rejects* it — never that
 * a correct input passes.
 *
 * The cases are drawn from §3's own list, restricted to the ones not already
 * covered by [`gate-runner.test.ts`](gate-runner.test.ts) (which handles the
 * pipeline-exit-code and missing-binary shapes) and
 * [`inc-001-regressions.test.ts`](inc-001-regressions.test.ts) (stale and
 * backwards cursors).
 */

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const migrationsDir = resolve(repoRoot, "migrations");

const writer: WriterContext = {
  writerId: "test:fault-injection",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

const directories: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  directories.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of directories) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

function envelope(id: string): EventEnvelope {
  const at = "2026-09-18T00:00:00.000Z";
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type: "interaction.observed",
    occurredAt: at,
    observedAt: at,
    recordedAt: at,
    actor: { type: "human", id: "fault-injection" },
    source: { kind: "fault-injection", ref: id },
    payload: { note: "the original material" },
    provenance: { origin: "direct", confidence: 1 },
    links: {},
  };
}

describe("a tampered event is refused, not returned", () => {
  it("throws a STORAGE_ERROR when the stored payload no longer matches its hash", () => {
    // The fault: someone — a migration, a manual fix, a corrupted write —
    // changes the stored material without changing `content_hash`. The store
    // must notice rather than hand back a record that is not what was written.
    // This is MF-01's countermeasure and INV-01's enforcement point.
    const dir = tempDir("praxis-fault-hash-");
    const store = new SqliteEventStore({
      filename: join(dir, "events.db"),
      migrationsDir,
    });
    store.append(envelope("fault-1"), writer);

    // Reach past the API deliberately. The whole point is a change the API
    // would never make, so it has to be made the way it would really happen.
    const raw = store.getById("fault-1");
    expect(raw?.contentHash).toBeTruthy();

    const db = new DatabaseSync(join(dir, "events.db"));
    db.prepare("UPDATE events SET payload_json = ? WHERE id = ?").run(
      JSON.stringify({ note: "tampered" }),
      "fault-1",
    );
    db.close();

    expect(() => store.getById("fault-1")).toThrow(/hash mismatch/i);
    store.close();
  });

  it("returns the record unchanged when nothing was tampered with", () => {
    // The control for the test above. Without it, a store that threw on every
    // read would satisfy the assertion and be useless.
    const dir = tempDir("praxis-fault-hash-ok-");
    const store = new SqliteEventStore({
      filename: join(dir, "events.db"),
      migrationsDir,
    });
    store.append(envelope("fault-2"), writer);
    const record = store.getById("fault-2");
    expect(record?.payload).toEqual({ note: "the original material" });
    store.close();
  });
});

describe("a malformed fixture is refused at load, not at run", () => {
  const base = {
    scenarioId: "sc-fault",
    scenarioVersion: "1.0.0",
    title: "fault fixture",
    corpusType: "corpus-c",
    ladder: "6V-1",
    concurrency: "C0",
    frozenAt: "2026-09-18T00:00:00.000Z",
    field: {
      externalVerification: "strong",
      consequence: "low",
      reversibility: "easy",
      feedbackLatency: "short",
      actors: [{ type: "human", id: "owner" }],
      placementRationale: "a fault fixture",
    },
    verifier: { kind: "filesystem", reference: "none", independent: true },
    episodes: [
      {
        episodeId: "e1",
        task: "do a thing",
        oracle: {
          taskOutcome: "succeed",
          residualIsReal: false,
          shouldIntervene: false,
          shouldProduceCandidate: false,
          rationale: "a fault fixture",
        },
      },
    ],
  };

  it("accepts the unmodified fixture, so the rejections below mean something", () => {
    expect(parseScenario("base", structuredClone(base)).scenarioId).toBe(
      "sc-fault",
    );
  });

  it("refuses an episode whose oracle omits shouldIntervene", () => {
    // §6 V1's negative sample is `shouldIntervene: false`. If the field could be
    // omitted, an oracle written by accident would silently mean "intervene" by
    // default at one site and "abstain" at another.
    const broken = structuredClone(base) as Record<string, unknown>;
    const episodes = broken["episodes"] as {
      oracle: Record<string, unknown>;
    }[];
    delete episodes[0]!.oracle["shouldIntervene"];
    expect(() => parseScenario("broken", broken)).toThrow(ScenarioLoadError);
    expect(() => parseScenario("broken", broken)).toThrow(/shouldIntervene/);
  });

  it("refuses an oracle whose rationale is missing", () => {
    const broken = structuredClone(base) as Record<string, unknown>;
    const episodes = broken["episodes"] as {
      oracle: Record<string, unknown>;
    }[];
    delete episodes[0]!.oracle["rationale"];
    expect(() => parseScenario("broken", broken)).toThrow(/rationale/);
  });

  it("refuses a scenario with no scenarioVersion", () => {
    // The version is what makes two runs non-comparable when the scenario text
    // moves. τ³-bench states the consequence directly; this project had no such
    // field before Phase 6V.
    const broken = structuredClone(base) as Record<string, unknown>;
    delete broken["scenarioVersion"];
    expect(() => parseScenario("broken", broken)).toThrow(/scenarioVersion/);
  });

  it("refuses corpus-i material with no provenance", () => {
    // The manifest schema requires `corpusProvenance` for sourced material, so
    // a scenario that omits it cannot produce a writable manifest. Refusing at
    // load turns that into a bad file rather than a crash six episodes in.
    const broken = structuredClone(base) as Record<string, unknown>;
    broken["corpusType"] = "corpus-i";
    expect(() => parseScenario("broken", broken)).toThrow(/corpusProvenance/);
  });

  it("refuses an empty episode list", () => {
    const broken = structuredClone(base) as Record<string, unknown>;
    broken["episodes"] = [];
    expect(() => parseScenario("broken", broken)).toThrow(/episodes/);
  });
});

describe("BP-062's trap: a mis-placed option is inert", () => {
  it("vitest ignores a top-level testTimeout, so a slow test still fails at the default", () => {
    // This is the fault BP-062 planted by accident, reproduced on purpose.
    //
    // `testTimeout` is a Vitest option and is only read under `test`. At the
    // top level it sits beside `resolve` and `plugins`, Vite reads the top level
    // and has no such option, and the file looks entirely correct. The project
    // shipped that mistake; it was caught only by a probe that slept six
    // seconds with no per-test timeout and failed at exactly 5000ms.
    //
    // The fixture sleeps 5.5s with `testTimeout: 60000` written at the top
    // level. If Vitest honoured it the test would pass. It must fail.
    const dir = tempDir("praxis-fault-config-");
    writeFileSync(
      join(dir, "vitest.config.mjs"),
      // Deliberately WRONG: top level, not under `test`.
      "export default { testTimeout: 60_000 };\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "slow.test.mjs"),
      'import { it, expect } from "vitest";\n' +
        'it("sleeps past the default budget", async () => {\n' +
        "  await new Promise((r) => setTimeout(r, 5500));\n" +
        "  expect(true).toBe(true);\n" +
        "});\n",
      "utf8",
    );
    // Node resolves `vitest` from the importing file upward, and the temp
    // directory has no node_modules. A junction (not a symlink) works without
    // elevation on Windows and needs no special handling elsewhere.
    symlinkSync(
      join(repoRoot, "node_modules"),
      join(dir, "node_modules"),
      "junction",
    );

    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "node_modules", "vitest", "vitest.mjs"), "run"],
      { cwd: dir, encoding: "utf8", shell: false, timeout: 120_000 },
    );

    // A non-zero exit is the assertion. If this ever passes, Vitest has started
    // honouring the top-level placement — and BP-062's whole entry needs
    // re-reading, because the config it describes would then be correct twice
    // over.
    expect(
      result.status,
      `vitest exited ${result.status} on a mis-placed testTimeout; the default ` +
        `should have failed the 5.5s test. stdout: ${(result.stdout ?? "").slice(-600)}`,
    ).not.toBe(0);
  }, 150_000);

  it("the project's own config keeps the option where Vitest reads it", () => {
    const config = readConfig();
    expect(
      config["test"],
      "vitest.config.mjs has no `test` block",
    ).toBeDefined();
    expect(
      (config["test"] as Record<string, unknown>)["testTimeout"],
      "testTimeout must live under `test`; see BP-062",
    ).toBeTypeOf("number");
    expect(
      config["testTimeout"],
      "a top-level testTimeout is silently ignored and must not be present",
    ).toBeUndefined();
  });
});

describe("an unsupported OS assumption is caught off-platform", () => {
  it("walks every POSIX ancestor, which is what BP-061 never did", () => {
    // BP-061's guard failed open on Linux because the ternary had identical
    // branches and dropped the first segment. Its test passed on Windows and
    // could not fail there. The injectable `PlatformPath` is what makes the
    // POSIX behaviour assertable from Windows, and this is that assertion
    // stated as the property the archive rule depends on.
    const walked = ancestorDirectories("/tmp/praxis-x/archive", posix);
    expect(walked).toEqual(["/tmp", "/tmp/praxis-x", "/tmp/praxis-x/archive"]);
    // The defect's signature: `/srv` produced an EMPTY walk, so nothing was
    // ever checked. An empty result here would mean the guard is not guarding.
    expect(ancestorDirectories("/srv", posix)).toEqual(["/srv"]);
  });

  it("would notice the defect if it came back", () => {
    // The negative control for the assertion above: the old algorithm is
    // reproduced and must produce a different answer.
    const defective = (target: string): string[] => {
      const resolved = target;
      const parts = resolved.split("/").filter((part) => part.length > 0);
      const drive: string | undefined = undefined;
      const rest = drive ? parts.slice(1) : parts.slice(1);
      return rest.map((_, index) => `/${rest.slice(0, index + 1).join("/")}`);
    };
    expect(defective("/tmp/praxis-x/archive")).not.toEqual(
      ancestorDirectories("/tmp/praxis-x/archive", posix),
    );
  });
});

function readConfig(): Record<string, unknown> {
  const text = readFileSync(resolve(repoRoot, "vitest.config.mjs"), "utf8");
  // A tiny reader rather than an import: importing the config would execute
  // `defineConfig` and the workspace alias scan, which is more than this
  // assertion needs and would make it depend on the packages directory.
  const match = /test:\s*\{([\s\S]*?)\n {2}\}/.exec(text);
  const found: Record<string, unknown> = {};
  if (match !== null) {
    const timeout = /testTimeout:\s*([0-9_]+)/.exec(match[1]!);
    if (timeout !== null) {
      found["test"] = { testTimeout: Number(timeout[1]!.replace(/_/g, "")) };
    }
  }
  // Detect a top-level placement: `testTimeout` appearing before the `test:`
  // block, at two-space indentation.
  if (/^ {2}testTimeout:/m.test(text)) found["testTimeout"] = true;
  return found;
}
