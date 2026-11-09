// Approved R01 domain probe only; never uses a real Habit store.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const parent = path.join(root, "test-results/stage-closure-20261031");
const work = fs.mkdtempSync(path.join(parent, "approved-r01-"));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const original = execFileSync(
  "git",
  [
    "show",
    "c3be4af760e8e7ec2f27184584b1c949484305e0:scripts/signal-capture.mjs",
  ],
  { cwd: path.join(parent, "habitat-source") },
);
if (
  hash(original) !==
  "f2e437b0d43d133501424cdecf2c3b281ba0f572974e14859e457c0759580ab5"
)
  throw Error("SOURCE_DRIFT");
const from = 'writeFileSync(join(targetDir, `${id}.md`), lines.join("\\n"));';
const to =
  'writeFileSync(join(targetDir, `${id}.md`), lines.join("\\n"), { flag: "wx" });';
const source = original.toString("utf8");
if (source.split(from).length !== 2) throw Error("PATCH_CONTEXT_MISMATCH");
const patched = source.replace(from, to);
const script = path.join(work, "signal-capture.mjs");
fs.writeFileSync(script, patched, { flag: "wx" });
const now = new Date();
const month = now.toISOString().slice(0, 7);
const id = "sig_" + now.toISOString().slice(0, 10).replaceAll("-", "") + "_001";
const signal = (value) => ({
  type: "preference",
  category: "synthetic",
  value,
  evidence: "synthetic-" + value,
});
const rows = [];
function run(home, arg, input) {
  const env = {
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.slice(0, 2),
    HOMEPATH: home.slice(2),
    TZ: "UTC",
  };
  const child = spawnSync(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=" + script,
      "--allow-fs-read=" + home,
      "--allow-fs-write=" + home,
      script,
      arg,
    ],
    {
      cwd: work,
      env,
      input: input ? JSON.stringify(input) : undefined,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 32768,
      windowsHide: true,
    },
  );
  return {
    arg,
    input: input ?? null,
    exitCode: child.status,
    error: child.error?.code ?? null,
    stdout: child.stdout,
    stderr: child.stderr,
  };
}
function create(name) {
  const home = path.join(work, name);
  fs.mkdirSync(home);
  return home;
}
function state(home) {
  const data = path.join(home, ".codex-habit");
  const buf = path.join(data, ".signal_buffer.json"),
    idx = path.join(data, ".signals_index.json");
  const files = [];
  const signals = path.join(data, "signals");
  for (const e of fs.readdirSync(signals, { withFileTypes: true })) {
    if (e.isDirectory())
      for (const name of fs.readdirSync(path.join(signals, e.name))) {
        const f = path.join(signals, e.name, name);
        files.push({
          name,
          sha256: hash(fs.readFileSync(f)),
          text: fs.readFileSync(f, "utf8"),
        });
      }
  }
  return {
    buffer: fs.existsSync(buf) ? JSON.parse(fs.readFileSync(buf)) : null,
    index:
      fs.existsSync(idx) && fs.statSync(idx).isFile()
        ? JSON.parse(fs.readFileSync(idx))
        : null,
    files,
  };
}
{
  const home = create("separate-flushes"),
    operations = [];
  operations.push(
    run(home, "--capture", signal("first")),
    run(home, "--flush"),
  );
  const first = state(home);
  operations.push(
    run(home, "--capture", signal("second")),
    run(home, "--flush"),
  );
  const after = state(home);
  rows.push({
    case: "two-flushes",
    operations,
    after,
    noOverwrite: first.files[0].sha256 === after.files[0].sha256,
    bufferRetained: after.buffer.signals[0]?.value === "second",
    bothFlushesSucceeded:
      operations[1].exitCode === 0 && operations[3].exitCode === 0,
  });
}
{
  const home = create("single-batch");
  const operations = [
    run(home, "--capture", signal("one")),
    run(home, "--capture", signal("two")),
    run(home, "--flush"),
  ];
  const after = state(home);
  rows.push({
    case: "single-batch-control",
    operations,
    after,
    consistent:
      after.files.length === 2 &&
      after.index.signals.length === 2 &&
      after.buffer.signals.length === 0,
  });
}
{
  const home = create("existing-file"),
    operations = [run(home, "--capture", signal("new"))];
  const target = path.join(home, ".codex-habit/signals", month);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, id + ".md"), "SYNTHETIC_EXISTING", {
    flag: "wx",
  });
  operations.push(run(home, "--flush"));
  const after = state(home);
  rows.push({
    case: "collision",
    operations,
    after,
    noOverwrite: after.files[0].text === "SYNTHETIC_EXISTING",
    bufferRetained: after.buffer.signals.length === 1,
  });
}
{
  const home = create("index-failure"),
    operations = [run(home, "--capture", signal("pending"))];
  fs.mkdirSync(path.join(home, ".codex-habit/.signals_index.json"));
  operations.push(run(home, "--flush"));
  const afterFailure = state(home);
  operations.push(run(home, "--flush"));
  const afterRetry = state(home);
  rows.push({
    case: "index-write-failure-and-one-retry",
    operations,
    afterFailure,
    afterRetry,
    bufferRetained: afterRetry.buffer.signals.length === 1,
    orphanFile: afterRetry.files.length === 1 && afterRetry.index === null,
    recoverableByPlainRetry: operations[2].exitCode === 0,
  });
}
function redact(v) {
  if (typeof v === "string")
    return v
      .replaceAll(root, "[PRAXIS_ROOT]")
      .replaceAll(root.split(path.sep).join("/"), "[PRAXIS_ROOT]");
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, redact(x)]),
    );
  return v;
}
const result = {
  date: "2026-11-04",
  authority:
    "Owner approved continuation; isolated R01 candidate verification only",
  node: process.version,
  canonical: false,
  sourceSha256: hash(original),
  patchedSha256: hash(Buffer.from(patched)),
  sandbox: path.relative(root, work).split(path.sep).join("/"),
  sourceUnchanged:
    hash(original) ===
    hash(
      execFileSync("git", ["show", "HEAD:scripts/signal-capture.mjs"], {
        cwd: path.join(parent, "habitat-source"),
      }),
    ),
  cases: rows,
  verdict:
    "ABORT_PATCH / INCOMPLETE_RECOVERY — no-overwrite guard is not a complete R01 fix",
  host: "NOT_MODIFIED / HABIT_DATA_NOT_READ",
  P1_P2: "NOT_RUN",
};
fs.writeFileSync(
  path.join(
    root,
    "labs/research-transition-w2026-45/evidence/R01_APPROVED_RECEIPT.json",
  ),
  JSON.stringify(redact(result), null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      verdict: result.verdict,
      rows: rows.map(
        ({
          case: name,
          operations,
          after,
          afterFailure,
          afterRetry,
          ...flags
        }) => ({
          case: name,
          exits: operations.map((x) => x.exitCode),
          ...flags,
        }),
      ),
    },
    null,
    2,
  ),
);
