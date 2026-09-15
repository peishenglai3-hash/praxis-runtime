import { log } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { clearTimeout, setTimeout as setTimer } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { SqliteEventStore } from "../packages/store/dist/index.js";

const writer = {
  writerId: "system:phase1-recovery",
  kind: "runtime",
  role: "OWNER",
  authn: "system",
  scopes: [
    "event.read",
    "event.append",
    "state.read",
    "residual.propose",
    "tool.execute",
    "asset.propose",
    "asset.activate",
    "asset.contest",
    "asset.disable",
    "asset.fork",
    "history.export",
    "history.purge",
    "system.migrate",
  ],
  policyVersion: 1,
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const workerScript = join(scriptDir, "phase1-crash-worker.mjs");
const migrationsDir = join(rootDir, "migrations");
const workerTimeoutMs = 15_000;
const temporaryDirectory = mkdtempSync(join(tmpdir(), "praxis-phase1-crash-"));
const filename = join(temporaryDirectory, "events.db");

function runCrashWorker() {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(execPath, [workerScript, filename, migrationsDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    let settled = false;
    const timeout = setTimer(() => {
      child.kill();
      if (settled) return;
      settled = true;
      rejectWorker(new Error("crash worker timed out"));
    }, workerTimeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectWorker(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      settled = true;
      resolveWorker({ code, signal, output, errorOutput });
    });
  });
}

async function removeTemporaryDirectory() {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError ?? new Error("temporary directory cleanup failed");
}

let testFailure;
try {
  const crashResult = await runCrashWorker();
  if (crashResult.code !== 17 || !crashResult.output.includes("UNCOMMITTED")) {
    throw new Error(
      `crash worker did not reach the intended point: ${JSON.stringify(crashResult)}`,
    );
  }

  const store = new SqliteEventStore({ filename, migrationsDir });
  try {
    if (
      store.getLastSeq() !== 0 ||
      store.getById("crash-only-event") !== null
    ) {
      throw new Error("uncommitted crash row survived recovery");
    }
    const result = store.append(
      {
        schemaVersion: "1",
        eventVersion: "1",
        id: "after-crash-event",
        type: "system.recovery-probe",
        occurredAt: "2026-09-13T00:00:00.000Z",
        observedAt: "2026-09-13T00:00:00.000Z",
        recordedAt: "2026-09-13T00:00:01.000Z",
        actor: { type: "system", id: "phase1-recovery" },
        operationId: "after-crash-operation",
        source: { kind: "phase1-crash-recovery" },
        payload: { recovered: true },
        provenance: { origin: "direct", confidence: 1 },
      },
      writer,
    );
    if (result.record.seq !== 1 || store.getLastSeq() !== 1) {
      throw new Error("post-crash write did not recover at seq 1");
    }
    log("Phase 1 crash recovery PASS (uncommitted transaction rolled back)");
  } finally {
    store.close();
  }
} catch (error) {
  testFailure = error;
} finally {
  try {
    await removeTemporaryDirectory();
  } catch (cleanupError) {
    if (testFailure === undefined) {
      testFailure = cleanupError;
    } else {
      log(`Phase 1 crash cleanup warning: ${cleanupError}`);
    }
  }
}

if (testFailure !== undefined) throw testFailure;
