#!/usr/bin/env node
/**
 * The canonical gate runner.
 *
 * `pnpm verify` is a chain of twelve `&&`-joined stages. It reports one exit
 * code for all of them, it stops at the first failure, and it says nothing
 * about which stage failed. That shape caused BP-060: the chain was read
 * through a pipe, the pipe's exit code was read instead of the chain's, and a
 * failing `format:check` was reported as a pass.
 *
 * This runner exists so that failure mode is structurally unavailable rather
 * than merely discouraged. Three properties do that work:
 *
 *   1. **No shell, ever.** Every stage is spawned with `shell: false` and an
 *      argv array, so no pipeline can exist to contribute an exit status.
 *      There is no `| tail` anywhere in this file, and one cannot be added to
 *      a command line this file does not build.
 *   2. **A stage result is an exit code or it is a harness failure.** A stage
 *      whose status is not a number — spawn error, signal, missing binary —
 *      is reported as `HARNESS`, never as a pass. `spawnSync` returns
 *      `status: null` for a command that never ran, and `null` is the value
 *      most likely to be read as "no problem". A stage's *output* is never
 *      consulted: a command that prints a reassuring sentence and exits
 *      non-zero has failed. A `HARNESS` stage promotes the whole *run* to
 *      `HARNESS` and stops, because "the gate could not run this" is a
 *      statement about the gate rather than about the code — otherwise a
 *      missing pnpm reads as twelve failing stages.
 *   3. **The semantic result is a file, not a status line.** The JSON written
 *      under `test-results/` is what CI and a human both consume. A caller who
 *      pipes this runner's output into `tail` can still mask the *exit code*,
 *      because that is the shell's behaviour and no program can prevent it —
 *      but they cannot mask the file. BP-060 is closed by making the exit code
 *      a convenience and the artifact the evidence.
 *
 * The artifact is written on every path, including refusal, so "the gate said
 * nothing" is distinguishable from "the gate was never run".
 *
 * The stage list is not free-standing: it is checked against the `pnpm ...`
 * names in `package.json#scripts["verify:chain"]`, in order, before anything
 * runs. `verify` itself is this runner, so the frozen chain lives in
 * `verify:chain` as data — the list of what must be verified is something the
 * gate can be held to, rather than a command line a runner could quietly
 * execute less of. If the two disagree the runner refuses to start, so a stage
 * cannot be dropped from the gate while both files still look reasonable on
 * their own.
 */
import { spawnSync } from "node:child_process";
import { error, log, warn } from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), "..");

/**
 * The twelve stages, in the order INC-001 section 10 froze, with the
 * evaluation harness self-tests appended in Phase 6V. The appended stage
 * runs no model and reads no credential: it validates the measurement
 * apparatus (`evals/test`), which is what the owner's brief section 3 asks
 * for under "Test the test". A stage that needed a provider key would make
 * this gate non-deterministic, and the boundary suite asserts the chain
 * contains no such script. The order is
 * load-bearing: the test layers must run before `build`, and the artifact
 * smoke steps after it, or the smoke steps test the previous build.
 */
export const stages = [
  { id: "verify:runtime", label: "runtime pins and lockfile integrity" },
  { id: "verify:deps", label: "workspace dependency integrity" },
  { id: "verify:lint", label: "format, lint, boundaries, two fixtures" },
  { id: "verify:typecheck", label: "typecheck and schema parity" },
  { id: "test:unit", label: "unit layer" },
  { id: "test:integration", label: "integration layer" },
  { id: "test:replay", label: "replay layer" },
  { id: "test:regression", label: "regression layer" },
  {
    id: "test:evals",
    label: "evaluation harness self-tests (no model, no network)",
  },
  { id: "build", label: "workspace build" },
  { id: "smoke:cli", label: "command-line smoke, against the build" },
  { id: "smoke:daemon", label: "daemon smoke, against the build" },
];

/**
 * How pnpm is reached without a shell.
 *
 * POSIX ships pnpm as an executable file, so `spawn("pnpm", …)` with
 * `shell: false` finds it and runs it directly. Windows ships it as a `.cmd`
 * shim, which `spawn` refuses with `EINVAL` unless a shell is used — and a
 * shell is exactly what this runner may not use. So on Windows the shim is
 * bypassed: the Node entry point it wraps is located and run under
 * `process.execPath`.
 */
export function resolvePnpmInvocation(platform = process.platform) {
  if (platform !== "win32") return ["pnpm"];

  const candidates = [];
  const execPath = process.env.npm_execpath;
  if (typeof execPath === "string" && /\.(?:mjs|cjs|js)$/.test(execPath)) {
    candidates.push(execPath);
  }
  candidates.push(join(defaultRoot, "node_modules", "pnpm", "bin", "pnpm.mjs"));
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    for (const extension of [".cmd", ".exe", ".ps1"]) {
      if (!existsSync(join(directory, `pnpm${extension}`))) continue;
      // npm's global layout puts the shim at <prefix>/pnpm.cmd and the
      // implementation at <prefix>/node_modules/pnpm/bin/pnpm.mjs.
      candidates.push(
        join(directory, "node_modules", "pnpm", "bin", "pnpm.mjs"),
      );
    }
  }
  const entry = candidates.find((candidate) => existsSync(candidate));
  return entry === undefined ? undefined : [process.execPath, entry];
}

/** The `pnpm <name>` sequence in a `verify` script, in order. */
export function verifyChain(verify) {
  if (typeof verify !== "string") return undefined;
  const names = [];
  for (const match of verify.matchAll(/pnpm\s+(?!-)([A-Za-z0-9:_-]+)/g)) {
    names.push(match[1]);
  }
  return names;
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  return typeof result.status === "number" && result.status === 0
    ? (result.stdout ?? "").trim()
    : undefined;
}

/**
 * Run one stage and classify the outcome.
 *
 * `status` is a number, or this is a harness failure. Nothing else is a pass.
 */
export function runStage(stage, { cwd, invocation }) {
  const startedAt = Date.now();
  const result = spawnSync(
    invocation[0],
    [...invocation.slice(1), "run", stage.id],
    { cwd, shell: false, stdio: ["ignore", "inherit", "inherit"] },
  );
  const durationMs = Date.now() - startedAt;

  if (typeof result.status !== "number") {
    return {
      id: stage.id,
      label: stage.label,
      status: "HARNESS",
      exitCode: null,
      durationMs,
      detail:
        result.error === undefined
          ? `terminated by signal ${String(result.signal)}`
          : `${result.error.code ?? "error"}: ${result.error.message}`,
    };
  }
  return {
    id: stage.id,
    label: stage.label,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    durationMs,
  };
}

function parseArguments(argv) {
  const options = { root: defaultRoot, out: undefined, only: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--root") options.root = resolve(argv[++index] ?? ".");
    else if (flag === "--out") options.out = resolve(argv[++index] ?? "");
    else if (flag === "--only")
      options.only = (argv[++index] ?? "").split(",").filter(Boolean);
    else {
      error(`unrecognised argument: ${flag}`);
      process.exit(2);
    }
  }
  return options;
}

export function runGate(options = {}) {
  const root = options.root ?? defaultRoot;
  const startedAt = new Date();

  const pinnedFile = join(root, ".node-version");
  const pinned = existsSync(pinnedFile)
    ? readFileSync(pinnedFile, "utf8").trim()
    : undefined;
  const commit = git(["rev-parse", "HEAD"], root);
  const dirty = (git(["status", "--porcelain"], root) ?? "") !== "";

  /**
   * `test-results/` is already ignored by `.gitignore`, so the artifact cannot
   * dirt the worktree it just certified — a gate that makes its own repository
   * dirty has certified something other than what will be committed.
   */
  const finish = (result, extra) => {
    const document = {
      schemaVersion: "1",
      gate: "praxis-core",
      result,
      complete: extra.complete ?? false,
      runtime: {
        node: process.versions.node,
        pinned,
        matchesPin: pinned === process.versions.node,
      },
      commit,
      commitShort: commit === undefined ? undefined : commit.slice(0, 12),
      dirty,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      stages: extra.stages ?? [],
      notRun: extra.notRun ?? [],
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    };
    const out = options.out ?? join(root, "test-results", "gate-result.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    document.artifactPath = out;
    return document;
  };

  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    const detail = `no package.json at ${root}; --root must point at a repository root`;
    error(detail);
    return finish("HARNESS", { detail });
  }
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

  const chain = verifyChain(packageJson?.scripts?.["verify:chain"]);
  if (chain === undefined) {
    const detail =
      "package.json has no `verify:chain` script; there is nothing to gate";
    error(detail);
    return finish("HARNESS", { detail });
  }
  const expected = stages.map((stage) => stage.id);
  if (chain.join(" ") !== expected.join(" ")) {
    error("the stage list and `package.json#scripts.verify:chain` disagree.");
    error(`  verify:chain: ${chain.join(" -> ")}`);
    error(`  stage list:   ${expected.join(" -> ")}`);
    error("Refusing to run: a gate that silently verifies less than it claims");
    error(
      "is the failure this runner exists to prevent. Reconcile them first.",
    );
    return finish("HARNESS", {
      detail:
        `the stage list and package.json#scripts.verify:chain disagree: ` +
        `verify:chain is [${chain.join(", ")}] but the stage list is [${expected.join(", ")}]`,
    });
  }

  const invocation = resolvePnpmInvocation();
  if (invocation === undefined) {
    const detail =
      "could not locate pnpm without a shell; install pnpm or run `pnpm verify`";
    error(detail);
    return finish("HARNESS", { detail });
  }

  const selected =
    options.only === undefined
      ? stages
      : stages.filter((stage) => options.only.includes(stage.id));
  if (selected.length === 0) {
    const detail = `--only matched no stage: ${(options.only ?? []).join(",")}`;
    error(detail);
    return finish("HARNESS", { detail });
  }
  if (selected.length !== stages.length) {
    warn(
      `[warn] --only selects ${selected.length} of ${stages.length} stages; this is not the gate`,
    );
  }

  const results = [];
  for (const stage of selected) {
    log(`\n=== ${stage.id} — ${stage.label} ===`);
    const result = runStage(stage, { cwd: root, invocation });
    const outcome =
      result.status === "PASS"
        ? `PASS (${result.durationMs}ms)`
        : `${result.status} exit=${String(result.exitCode)}${
            result.detail === undefined ? "" : ` (${result.detail})`
          } (${result.durationMs}ms)`;
    log(`--- ${stage.id}: ${outcome}`);
    results.push(result);
    if (result.status !== "PASS" && options.keepGoing !== true) break;
  }

  const notRun = selected.slice(results.length).map((stage) => stage.id);

  /**
   * A stage reporting `HARNESS` is categorically different from one reporting
   * `FAIL`: the code did not fail, the gate could not run it. That is a
   * statement about the runner, so it is reported at the level of the run.
   *
   * Both platforms reach this the same way now. They did not before: on POSIX
   * the resolver returns `pnpm` unconditionally and the *spawn* fails, so a
   * missing pnpm read as eleven failing stages, while on Windows the resolver
   * declines and the run refused immediately. A test that asserted one shape
   * passed on Windows and failed on Linux — the same defect as BP-061 and
   * BP-063, arriving in the code written to catch them.
   */
  const unrunnable = results.find((entry) => entry.status === "HARNESS");
  if (unrunnable !== undefined) {
    const detail = `stage ${unrunnable.id} could not be run: ${String(unrunnable.detail)}`;
    error(`\n${detail}`);
    return finish("HARNESS", {
      complete: false,
      stages: results,
      notRun,
      detail,
    });
  }

  const failed = results.filter((result) => result.status !== "PASS");
  const complete = results.length === selected.length;
  const document = finish(!complete || failed.length > 0 ? "FAIL" : "PASS", {
    complete,
    stages: results,
    notRun,
  });

  log("");
  log(
    `gate ${document.result}${complete ? "" : " (incomplete)"} — node ${document.runtime.node}` +
      `${document.runtime.matchesPin ? "" : ` (pinned ${String(pinned)})`}`,
  );
  for (const entry of document.stages) {
    log(
      `  ${entry.status.padEnd(7)} ${entry.id.padEnd(20)} ${String(entry.exitCode ?? "-").padStart(3)}  ${entry.durationMs}ms`,
    );
  }
  for (const id of document.notRun) log(`  NOT-RUN ${id}`);
  log(`result written to ${document.artifactPath}`);

  return document;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath;

if (invokedDirectly) {
  const document = runGate(parseArguments(process.argv.slice(2)));
  process.exit(document.result === "PASS" ? 0 : 1);
}
