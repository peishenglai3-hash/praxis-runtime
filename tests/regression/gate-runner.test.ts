import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * BP-060 was a green reading taken from the wrong place. `pnpm verify` was run
 * through `| tail`, the pipeline's exit code was read instead of the chain's,
 * and a failing `format:check` was reported as a pass. The reassuring line
 * `All matched files use Prettier code style!` was on screen; the non-zero exit
 * code was further down and unread.
 *
 * These tests hold the gate runner to the properties that make that
 * unavailable rather than merely discouraged: a stage passes only if its own
 * exit code is zero, its output is never consulted, and a stage that could not
 * be spawned at all is a failure rather than the `null` `spawnSync` returns —
 * the value most likely to be read as "no problem".
 *
 * Each test builds a throwaway repository whose `verify` chain is copied from
 * the real `package.json`, so the runner's own plan check has something
 * truthful to agree with, and replaces every stage with something cheap. Only
 * the stage under test is given real work.
 */

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const gateScript = join(repoRoot, "scripts", "gate.mjs");
const cycleScript = join(repoRoot, "scripts", "assert-cycle-detected.mjs");
const prettierBin = join(
  repoRoot,
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs",
);

interface StageResult {
  id: string;
  label: string;
  status: string;
  exitCode: number | null;
  durationMs: number;
  detail?: string;
}

interface GateDocument {
  result: string;
  complete: boolean;
  stages: StageResult[];
  notRun: string[];
  runtime: { node: string; pinned?: string; matchesPin: boolean };
  commit?: string;
  detail?: string;
}

let fixture: string | undefined;

afterEach(() => {
  if (fixture !== undefined) {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 5 });
    fixture = undefined;
  }
});

/**
 * The stage ids the frozen `verify:chain` names, in order.
 *
 * `verify` itself is the gate runner, so the chain it must agree with lives in
 * `verify:chain`. That indirection is the point: the *list* of what has to be
 * verified is data the gate can be held to, rather than a command line that a
 * runner could quietly execute less of.
 */
function realStageIds(): { ids: string[]; verify: string } {
  const real = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };
  const verify = real.scripts["verify:chain"] ?? "";
  const ids = [...verify.matchAll(/pnpm\s+(?!-)([A-Za-z0-9:_-]+)/g)].map(
    (match) => match[1] as string,
  );
  return { ids, verify };
}

/**
 * The environment with every spelling of `PATH` and `npm_execpath` removed.
 *
 * Two Windows-shaped traps live here, and both were hit before this helper
 * existed:
 *
 *   1. Windows spells the variable `Path`, not `PATH`. Passing `{ PATH: "" }`
 *      on top of the inherited environment therefore adds a *second* variable
 *      rather than replacing the first, and the original still wins, so a test
 *      that means "with nothing on PATH" runs with everything on it.
 *   2. The same applies to `npm_execpath`, which pnpm sets when it runs a
 *      script but not under `pnpm exec`. Under `pnpm run` the runner found that
 *      variable, resolved pnpm through it, ran a stage, and reported FAIL
 *      instead of HARNESS — the test passed under `pnpm exec` and failed in
 *      the gate for a reason that had nothing to do with what it asserted.
 *
 * Both are the same shape as the defects the gate runner exists to catch: a
 * result read from the wrong place.
 */
function envWithoutPath(): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    ([key]) => !/^path$/i.test(key) && !/^npm_execpath$/i.test(key),
  );
  return { ...Object.fromEntries(kept as [string, string][]), PATH: "" };
}

function invoke(
  scripts: Record<string, string>,
  files: Record<string, string> = {},
  env?: Record<string, string>,
): { document: GateDocument; exitCode: number | null; stdout: string } {
  fixture = mkdtempSync(join(tmpdir(), "praxis-gate-"));
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ name: "gate-fixture", private: true, scripts }, null, 2),
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(fixture, name), content, "utf8");
  }
  const out = join(fixture, "gate-result.json");
  const run = spawnSync(
    process.execPath,
    [gateScript, "--root", fixture, "--out", out],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: env ?? (process.env as Record<string, string>),
    },
  );
  return {
    document: JSON.parse(readFileSync(out, "utf8")) as GateDocument,
    exitCode: run.status,
    stdout: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/** The frozen chain, with every stage replaced by a command that does nothing. */
function quietScripts(
  overrides: Record<string, string>,
): Record<string, string> {
  const { ids, verify } = realStageIds();
  const scripts: Record<string, string> = { "verify:chain": verify };
  for (const id of ids) scripts[id] = `node -e ""`;
  return { ...scripts, ...overrides };
}

describe("the gate runner reads exit codes, not output", () => {
  it("fails a stage that prints the reassuring line and exits non-zero", () => {
    // BP-060 in one assertion. The sentence printed here is the one
    // `format:check` prints when it *passes*; the exit code is the only thing
    // that distinguishes this from a real pass.
    const { document, exitCode } = invoke(
      quietScripts({
        "verify:lint": `node -e "console.log('All matched files use Prettier code style!'); process.exit(1)"`,
      }),
    );

    const lint = document.stages.find((stage) => stage.id === "verify:lint");
    expect(lint?.status).toBe("FAIL");
    expect(lint?.exitCode).toBe(1);
    expect(document.result).toBe("FAIL");
    expect(document.complete).toBe(false);
    expect(exitCode).not.toBe(0);
  });

  it("stops at the first failure and names the stages it did not run", () => {
    // A chain that stops silently cannot be distinguished from a chain that
    // passed everything; the runner has to say what it skipped.
    const { document } = invoke(
      quietScripts({ "verify:lint": `node -e "process.exit(4)"` }),
    );

    expect(document.stages.at(-1)?.id).toBe("verify:lint");
    expect(document.notRun).toHaveLength(
      realStageIds().ids.length - document.stages.length,
    );
    expect(document.notRun).toContain("smoke:daemon");
  });

  it("fails a stage whose command does not exist, rather than passing it", () => {
    // The command is run *by* pnpm, so a missing binary surfaces as pnpm's own
    // non-zero exit. The point of the assertion is that a command which
    // produced no output and no result is still not a pass.
    const { document, exitCode } = invoke(
      quietScripts({ "verify:lint": "definitely-not-a-real-binary-praxis" }),
    );

    const lint = document.stages.find((stage) => stage.id === "verify:lint");
    expect(lint?.status).toBe("FAIL");
    expect(lint?.exitCode).not.toBe(0);
    expect(document.result).toBe("FAIL");
    expect(exitCode).not.toBe(0);
  });

  it("reports a runner that could not be spawned as HARNESS, never as a pass", () => {
    // `spawnSync` returns `status: null` for a command that never ran, and
    // `null` is the value most likely to be read as "no problem": it is falsy,
    // so `if (status)` reads it as success. With nothing on PATH the runner
    // itself cannot be started, and the only safe report is a failure.
    const { document, exitCode } = invoke(
      quietScripts({}),
      {},
      envWithoutPath(),
    );

    expect(document.result).toBe("HARNESS");
    // The *shape* differs by platform, and asserting one shape is how this test
    // first passed on Windows and failed on Linux. Windows declines to resolve
    // pnpm and runs nothing; POSIX resolves it, fails the spawn, and stops
    // after one stage. What has to hold on both is the property: nothing was
    // reported as a pass, and the run says why.
    expect(document.stages.every((stage) => stage.status !== "PASS")).toBe(
      true,
    );
    expect(document.detail).toContain("pnpm");
    expect(exitCode).not.toBe(0);
  });

  it("passes the whole chain when every stage exits zero, quietly", () => {
    const { document, exitCode } = invoke(quietScripts({}));

    expect(document.result).toBe("PASS");
    expect(document.complete).toBe(true);
    expect(document.notRun).toEqual([]);
    expect(document.stages).toHaveLength(realStageIds().ids.length);
    expect(exitCode).toBe(0);
  });
});

describe("dependency-boundary fixtures are independent of the caller cwd", () => {
  it("rejects the intentional cycle when launched outside the repository", () => {
    const result = spawnSync(process.execPath, [cycleScript], {
      cwd: tmpdir(),
      encoding: "utf8",
      shell: false,
    });

    expect(result.status, `${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(
      0,
    );
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain(
      "Intentional dependency cycle rejected as expected",
    );
  });
});

describe("the gate runner refuses a gate smaller than it claims", () => {
  it("refuses to run when the frozen chain omits a stage", () => {
    // The hazard is not a failing stage, it is a *missing* one: drop the last
    // stage from `verify:chain` and the gate would still report PASS while
    // checking less than it did yesterday. Both files would look reasonable
    // alone.
    const { ids, verify } = realStageIds();
    const trimmed = verify.replace(
      new RegExp(`\\s*&&\\s*pnpm\\s+${ids.at(-1)}\\b`),
      "",
    );
    const scripts: Record<string, string> = { "verify:chain": trimmed };
    for (const id of ids) scripts[id] = `node -e ""`;

    const { document, exitCode, stdout } = invoke(scripts);

    expect(document.result).toBe("HARNESS");
    expect(document.stages).toEqual([]);
    expect(document.detail).toContain("disagree");
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("Refusing to run");
  });

  it("writes its artifact even when it refuses, so silence is not ambiguity", () => {
    // "The gate said nothing" has to be distinguishable from "the gate was
    // never run" — the same class of mistake as reading an empty result as a
    // clean one.
    const { document } = invoke({ "verify:chain": "pnpm verify:runtime" });
    expect(document.result).toBe("HARNESS");
    expect(document.detail).toBeDefined();
  });
});

describe("a real failing format check", () => {
  it("fails when real prettier rejects a real file", () => {
    // `check.mjs` carries the absolute path to prettier as a JS literal, so a
    // repository path containing spaces or non-ASCII characters never reaches
    // a shell. The file under check is genuinely unformatted.
    const checker = [
      `import { spawnSync } from "node:child_process";`,
      `const result = spawnSync(`,
      `  process.execPath,`,
      `  [${JSON.stringify(prettierBin)}, "--check", "."],`,
      `  { stdio: "inherit" },`,
      `);`,
      `process.exit(result.status ?? 1);`,
      ``,
    ].join("\n");

    const { document, exitCode } = invoke(
      quietScripts({ "verify:lint": "node check.mjs" }),
      {
        "check.mjs": checker,
        "unformatted.md":
          "#   Heading with stray spaces\n\n*   first\n*   second\n",
      },
    );

    const lint = document.stages.find((stage) => stage.id === "verify:lint");
    expect(lint?.status).toBe("FAIL");
    expect(lint?.exitCode).not.toBe(0);
    expect(document.result).toBe("FAIL");
    expect(exitCode).not.toBe(0);
  });
});
