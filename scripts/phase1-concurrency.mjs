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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const workerScript = join(scriptDir, "phase1-concurrency-worker.mjs");
const migrationsDir = join(rootDir, "migrations");
const workerCount = 4;
const eventsPerWorker = 24;
const workerTimeoutMs = 15_000;
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "praxis-phase1-concurrency-"),
);
const filename = join(temporaryDirectory, "events.db");

function runWorker(workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [
        workerScript,
        filename,
        migrationsDir,
        String(workerId),
        String(eventsPerWorker),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
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
      rejectWorker(new Error(`worker ${workerId} timed out`));
    }, workerTimeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectWorker(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        rejectWorker(
          new Error(
            `worker ${workerId} failed with code ${code ?? "null"} signal ${signal ?? "none"}: ${errorOutput}`,
          ),
        );
        return;
      }
      resolveWorker({ output, errorOutput });
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
  const workerResults = await Promise.all(
    Array.from({ length: workerCount }, (_, index) => runWorker(index)),
  );
  const store = new SqliteEventStore({ filename, migrationsDir });
  try {
    const events = store.getSince(0, 10_000);
    const expectedCount = 2 + workerCount * eventsPerWorker;
    if (
      events.length !== expectedCount ||
      store.getLastSeq() !== expectedCount
    ) {
      throw new Error(
        `concurrency count mismatch: expected ${expectedCount}, got ${events.length}/${store.getLastSeq()}`,
      );
    }
    const sharedEvents = events.filter(
      (event) => event.id === "concurrency-shared-event",
    );
    if (sharedEvents.length !== 1) {
      throw new Error(
        `shared idempotency mismatch: ${sharedEvents.length} rows`,
      );
    }
    const operationOnlyEvents = events.filter(
      (event) => event.operationId === "concurrency-operation-only",
    );
    if (operationOnlyEvents.length !== 1) {
      throw new Error(
        `shared operation idempotency mismatch: ${operationOnlyEvents.length} rows`,
      );
    }
    const workerIds = new Set(
      events
        .filter((event) => /^concurrency-unique-\d+-\d+$/.test(event.id))
        .map((event) => event.actor.id),
    );
    if (workerIds.size !== workerCount) {
      throw new Error(
        `worker coverage mismatch: ${workerIds.size}/${workerCount}`,
      );
    }
    const insertedSharedCount = workerResults.filter(
      (result) => JSON.parse(result.output.trim()).insertedShared,
    ).length;
    if (insertedSharedCount !== 1) {
      throw new Error(`expected one shared insert, got ${insertedSharedCount}`);
    }
    const operationOnlyOutcomes = workerResults.map(
      (result) => JSON.parse(result.output.trim()).operationOnlyOutcome,
    );
    if (
      operationOnlyOutcomes.filter((outcome) => outcome === "inserted")
        .length !== 1 ||
      operationOnlyOutcomes.filter((outcome) => outcome === "conflict")
        .length !==
        workerCount - 1
    ) {
      throw new Error(
        `expected one operation-only insert and ${workerCount - 1} conflicts, got ${operationOnlyOutcomes.join(",")}`,
      );
    }
    log(
      `Phase 1 concurrency PASS (${workerCount} processes, ${eventsPerWorker} events each, ${events.length} rows)`,
    );
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
      log(`Phase 1 concurrency cleanup warning: ${cleanupError}`);
    }
  }
}

if (testFailure !== undefined) throw testFailure;
