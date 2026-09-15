import { spawn } from "node:child_process";
import { log } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { RuntimeCompositionRoot } from "../packages/runtime/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const migrationsDir = join(rootDir, "migrations");
const workerScript = join(scriptDir, "phase4-assets-worker.mjs");
const writer = {
  writerId: "test:phase4-owner",
  kind: "human",
  role: "OWNER",
  authn: "embedded-local",
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

function event(id) {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type: "interaction.observed",
    occurredAt: "2026-09-15T00:00:00.000Z",
    observedAt: "2026-09-15T00:00:00.000Z",
    recordedAt: "2026-09-15T00:00:00.000Z",
    actor: { type: "human", id: "phase4-owner" },
    operationId: id,
    source: { kind: "phase4-scenario", ref: id },
    payload: { id },
    provenance: { origin: "direct", confidence: 1 },
  };
}

function runWorker(filename, workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [workerScript, filename, migrationsDir, String(workerId)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.once("error", rejectWorker);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectWorker(new Error(`phase4 worker ${workerId} failed: ${errors}`));
        return;
      }
      try {
        resolveWorker(JSON.parse(output.trim()));
      } catch (error) {
        rejectWorker(
          new Error(`phase4 worker output invalid: ${String(error)}`),
        );
      }
    });
  });
}

async function removeDirectory(directory) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(directory, {
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
  throw lastError ?? new Error("phase4 temporary directory cleanup failed");
}

const directory = mkdtempSync(join(tmpdir(), "praxis-phase4-scenario-"));
const filename = join(directory, "events.db");
let root;
try {
  const store = new SqliteEventStore({ filename, migrationsDir });
  root = new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase4-owner" },
    writer,
  }).start();
  for (const id of [
    "asset-provenance",
    "episode-event-1",
    "episode-event-2",
    "validation-event",
  ]) {
    root.runtime.appendEvent(event(id));
  }
  root.runtime.proposeAsset({
    id: "asset-cas",
    kind: "rule",
    version: "1.0.0",
    body: { rule: "retain source evidence" },
    derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
    createdAt: "2026-09-15T00:00:00.000Z",
  });
  root.close();
  root = undefined;

  const workers = await Promise.all(
    Array.from({ length: 4 }, (_, index) => runWorker(filename, index)),
  );
  const inserted = workers.filter((item) => item.status === "inserted");
  const conflicts = workers.filter((item) => item.status === "conflict");
  if (inserted.length !== 1 || conflicts.length !== 3) {
    throw new Error(`phase4 CAS mismatch: ${JSON.stringify(workers)}`);
  }

  const reopenedStore = new SqliteEventStore({ filename, migrationsDir });
  root = new RuntimeCompositionRoot({
    store: reopenedStore,
    mode: "embedded",
    actor: { type: "human", id: "phase4-owner" },
    writer,
  }).start();
  root.catchUpCoreProjections();
  const asset = root.inspectAsset("asset-cas");
  if (asset?.status !== "validated" || asset.revision !== 2) {
    throw new Error(`phase4 final asset mismatch: ${JSON.stringify(asset)}`);
  }
  if (root.doctor().status !== "pass") {
    throw new Error("phase4 doctor did not pass after concurrent CAS");
  }
  log(
    `Phase 4 scenario PASS (one revision winner, ${conflicts.length} explicit conflicts, doctor pass)`,
  );
} finally {
  root?.close();
  await removeDirectory(directory);
}
