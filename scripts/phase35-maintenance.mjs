import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { log } from "node:console";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const workerScript = join(scriptDir, "phase35-lock-worker.mjs");
const migrationsDir = join(rootDir, "migrations");
const directory = mkdtempSync(join(tmpdir(), "praxis-phase35-lock-"));
const filename = join(directory, "events.db");
const workerCount = 4;

function runWorker(workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [workerScript, filename, migrationsDir, String(workerId), "400"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.once("error", rejectWorker);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        rejectWorker(
          new Error(
            `phase35 worker ${workerId} failed (${code ?? "null"}/${signal ?? "none"}): ${errors}`,
          ),
        );
        return;
      }
      try {
        resolveWorker(JSON.parse(output.trim()));
      } catch (error) {
        rejectWorker(
          new Error(`phase35 worker output was invalid: ${String(error)}`),
        );
      }
    });
  });
}

let runError;
try {
  const results = await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runWorker(index)),
  );
  const acquired = results.filter((result) => result.acquired);
  const rejected = results.filter((result) => !result.acquired);
  if (acquired.length !== 1 || rejected.length !== workerCount - 1) {
    throw new Error(`writer ownership mismatch: ${JSON.stringify(results)}`);
  }
  log(
    `Phase 3.5 concurrent writer scenario PASS (${acquired.length} owner, ${rejected.length} fail-fast conflicts)`,
  );
} catch (error) {
  runError = error;
}

let cleanupError;
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

if (runError !== undefined) throw runError;
if (cleanupError !== undefined) {
  throw cleanupError;
}
