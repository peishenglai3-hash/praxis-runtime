#!/usr/bin/env node
/**
 * Phase 5 command-line scenario.
 *
 * Runs the built command-line entry point as a real process, because an
 * in-process test cannot catch a bundling or module-resolution failure, and
 * because the exit code is a process-level contract. The scenario walks the
 * sequence an operator would: initialize, pass doctor, dry-run an import,
 * apply it, confirm the replay is idempotent, then corrupt the database behind
 * the runtime's back and require doctor to locate the damage.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { log } from "node:console";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process, { execPath } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const cli = join(rootDir, "apps", "cli", "dist", "index.js");
const migrationsDir = join(rootDir, "migrations");
const fixtureData = join(rootDir, "fixtures", "legacy", "data");

function invoke(args, cwd) {
  return new Promise((resolveCall, rejectCall) => {
    const child = spawn(execPath, [cli, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PRAXIS_MIGRATIONS_DIR: migrationsDir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", rejectCall);
    child.once("close", (code) => resolveCall({ code, stdout, stderr }));
  });
}

function requireExit(result, expected, label) {
  if (result.code !== expected) {
    throw new Error(
      `${label}: expected exit ${expected}, received ${result.code}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function parseDocument(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${label}: stdout was not a single machine document (${String(error)})\n${result.stdout}`,
    );
  }
}

let directory;
let runError;

try {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase5-cli-"));

  const help = await invoke(["--help"], directory);
  requireExit(help, 0, "help");
  if (!help.stdout.includes("Usage: praxis")) {
    throw new Error("help did not print the command list");
  }

  const noCommand = await invoke([], directory);
  requireExit(noCommand, 2, "no command");
  if (!noCommand.stderr.includes("USAGE_ERROR")) {
    throw new Error("an empty invocation must report a usage error");
  }

  const init = await invoke(["init", "--json"], directory);
  requireExit(init, 0, "init");
  const initDocument = parseDocument(init, "init");
  if (initDocument.schemaVersion !== "1" || initDocument.ok !== true) {
    throw new Error("init did not emit a versioned success document");
  }

  const doctor = await invoke(["doctor", "--json"], directory);
  requireExit(doctor, 0, "doctor");
  const doctorDocument = parseDocument(doctor, "doctor");
  if (doctorDocument.result.status !== "pass") {
    throw new Error("doctor did not pass on a freshly initialized runtime");
  }

  const dryRun = await invoke(
    ["legacy", "import", fixtureData, "--dry-run", "--json"],
    directory,
  );
  requireExit(dryRun, 0, "legacy dry run");
  const dryRunDocument = parseDocument(dryRun, "legacy dry run");
  const planHash = dryRunDocument.result.plan.planHash;
  const anomalies = dryRunDocument.result.plan.inventory.anomalies;
  if (typeof planHash !== "string" || planHash.length !== 64) {
    throw new Error("the dry run did not print a plan hash");
  }
  if (anomalies.length === 0) {
    throw new Error("the dry run located no anomalies on the fixture");
  }

  const unconfirmed = await invoke(
    ["legacy", "import", fixtureData, "--confirm", "--json"],
    directory,
  );
  requireExit(unconfirmed, 2, "unconfirmed import");

  const mismatched = await invoke(
    [
      "legacy",
      "import",
      fixtureData,
      "--confirm",
      "--plan-hash",
      "0".repeat(64),
      "--json",
    ],
    directory,
  );
  requireExit(mismatched, 6, "mismatched plan hash");

  const applied = await invoke(
    [
      "legacy",
      "import",
      fixtureData,
      "--confirm",
      "--plan-hash",
      planHash,
      "--json",
    ],
    directory,
  );
  requireExit(applied, 0, "legacy import");
  const appliedDocument = parseDocument(applied, "legacy import");
  if (appliedDocument.result.application.status !== "applied") {
    throw new Error("the import did not report an applied run");
  }

  const replayed = await invoke(
    [
      "legacy",
      "import",
      fixtureData,
      "--confirm",
      "--plan-hash",
      planHash,
      "--json",
    ],
    directory,
  );
  requireExit(replayed, 0, "legacy replay");
  const replayDocument = parseDocument(replayed, "legacy replay");
  if (
    replayDocument.result.application.status !== "already-imported" ||
    replayDocument.result.application.appendedEvents !== 0
  ) {
    throw new Error("a repeated import was not idempotent");
  }

  const afterImport = await invoke(["doctor", "--json"], directory);
  requireExit(afterImport, 0, "doctor after import");
  const afterDocument = parseDocument(afterImport, "doctor after import");
  if (afterDocument.result.status !== "pass") {
    throw new Error("doctor did not pass after a legacy import");
  }

  const runs = await invoke(["legacy", "runs", "--json"], directory);
  requireExit(runs, 0, "legacy runs");
  const runsDocument = parseDocument(runs, "legacy runs");
  if (runsDocument.result.count !== 1) {
    throw new Error("the ledger did not record exactly one import run");
  }

  // Corrupt the database behind the runtime's back. The projection store and
  // the ledger are both damaged in ways only doctor can see: a projection's
  // current state disappears, and one imported record is removed so the run's
  // declared counts no longer match the ledger.
  const database = new DatabaseSync(join(directory, ".praxis", "events.db"));
  try {
    database.exec(
      "DELETE FROM projection_state WHERE projection_name = 'project'",
    );
    database.exec(
      "DELETE FROM events WHERE type = 'legacy.signal.imported' AND seq = (SELECT MIN(seq) FROM events WHERE type = 'legacy.signal.imported')",
    );
  } finally {
    database.close();
  }

  const corrupted = await invoke(["doctor", "--json"], directory);
  requireExit(corrupted, 6, "doctor on a corrupted database");
  const corruptedDocument = parseDocument(
    corrupted,
    "doctor on a corrupted database",
  );
  if (corruptedDocument.result.status !== "fail") {
    throw new Error("doctor reported success against a corrupted database");
  }
  const failingNames = corruptedDocument.result.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.name);
  if (!failingNames.includes("projection:project")) {
    throw new Error(
      `doctor did not name the missing projection: ${JSON.stringify(failingNames)}`,
    );
  }
  if (!failingNames.includes("legacy-import-integrity")) {
    throw new Error(
      `doctor did not name the damaged import record: ${JSON.stringify(failingNames)}`,
    );
  }

  log(
    `Phase 5 CLI scenario PASS (init/doctor, dry-run -> apply -> idempotent replay, ${anomalies.length} anomalies, doctor located ${failingNames.length} injected fault(s))`,
  );
} catch (error) {
  runError = error;
}

let cleanupError;
if (directory !== undefined) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      break;
    } catch (error) {
      if (attempt === 7) {
        cleanupError = error;
        break;
      }
      await delay(100);
    }
  }
}

if (runError !== undefined) throw runError;
if (cleanupError !== undefined) throw cleanupError;
