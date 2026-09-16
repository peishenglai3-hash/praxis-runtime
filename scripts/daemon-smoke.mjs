#!/usr/bin/env node
/**
 * IR-04 step 11 — daemon smoke.
 *
 * The daemon is fail-closed: it catches projections up, runs doctor, and
 * refuses to announce `ready` if either fails. That property had no executable
 * coverage anywhere in the verification chain — the Phase 3.5 daemon evidence
 * was an ad-hoc run, not a gate — so this script exercises both halves against
 * a real process and a real database:
 *
 *   1. a healthy store starts and reports ready, and exits 0;
 *   2. a store with an injected fault is refused, and exits non-zero.
 *
 * The fault is a managed-backup row whose file does not exist. Projection
 * catch-up cannot repair it, so the refusal proves the doctor gate rather than
 * the catch-up step.
 */
import { spawnSync } from "node:child_process";
import { log } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonEntry = join(rootDir, "apps", "daemon", "dist", "index.js");
const cliEntry = join(rootDir, "apps", "cli", "dist", "index.js");
const migrationsDir = join(rootDir, "migrations");

function run(entry, args, cwd) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PRAXIS_MIGRATIONS_DIR: migrationsDir,
      PRAXIS_DATA_DIR: join(cwd, ".praxis"),
    },
  });
}

function lastJsonLine(text) {
  const line = text.trim().split("\n").filter(Boolean).pop();
  return line === undefined ? null : JSON.parse(line);
}

const directory = mkdtempSync(join(tmpdir(), "praxis-daemon-smoke-"));
try {
  const initialized = run(cliEntry, ["init", "--json"], directory);
  if (initialized.status !== 0) {
    throw new Error(`init failed: ${initialized.stdout}${initialized.stderr}`);
  }

  // 1. A healthy store starts.
  const healthy = run(daemonEntry, ["--once"], directory);
  const healthyReport = lastJsonLine(healthy.stdout ?? "");
  if (healthy.status !== 0) {
    throw new Error(
      `daemon refused a healthy store (exit ${healthy.status}): ${healthy.stderr}`,
    );
  }
  if (healthyReport?.ready !== true) {
    throw new Error(`daemon did not report ready: ${healthy.stdout}`);
  }
  if (
    !Array.isArray(healthyReport.catchUp) ||
    healthyReport.doctor === undefined
  ) {
    throw new Error(
      "daemon ready report is missing its catch-up or doctor evidence",
    );
  }

  // 2. Inject a fault doctor must catch and catch-up cannot repair.
  const database = new DatabaseSync(join(directory, ".praxis", "events.db"));
  try {
    database
      .prepare(
        `INSERT INTO managed_backups (
           backup_id, schema_version, path, created_at,
           first_event_seq, last_event_seq, projection_versions_json,
           source_db_sha256, backup_sha256, status
         ) VALUES (?, '1', ?, ?, 0, 0, '{}', ?, ?, 'active')`,
      )
      .run(
        "daemon-smoke-missing",
        join(directory, "does-not-exist.db"),
        Date.now(),
        "0".repeat(64),
        "1".repeat(64),
      );
  } finally {
    database.close();
  }

  const refused = run(daemonEntry, ["--once"], directory);
  if (refused.status === 0) {
    throw new Error(
      "daemon announced ready on a store with a missing managed backup",
    );
  }
  const refusal = lastJsonLine(refused.stderr ?? "");
  if (refusal?.ready !== false) {
    throw new Error(`daemon failure report is malformed: ${refused.stderr}`);
  }
  if (typeof refusal.error !== "string" || !refusal.error.includes("doctor")) {
    throw new Error(
      `daemon refused for the wrong reason: ${JSON.stringify(refusal)}`,
    );
  }

  log(
    "daemon smoke PASS (healthy store ready + exit 0; injected fault refused + non-zero, doctor gate)",
  );
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
}
