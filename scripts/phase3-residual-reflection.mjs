import { log } from "node:console";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { clearTimeout, setTimeout as setTimer } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ReflectionController } from "../packages/reflection/dist/index.js";
import { ResidualDetector } from "../packages/residual/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const migrationsDir = join(rootDir, "migrations");
const workerScript = join(scriptDir, "phase3-residual-reflection-worker.mjs");
const workerCount = 4;
const workerTimeoutMs = 20_000;

function runWorker(filename, workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [workerScript, filename, migrationsDir, String(workerId)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errorOutput = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    const timeout = setTimer(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectWorker(new Error(`phase3 worker ${workerId} timed out`));
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
            `phase3 worker ${workerId} failed with code ${code ?? "null"} signal ${signal ?? "none"}: ${errorOutput}`,
          ),
        );
        return;
      }
      try {
        resolveWorker(JSON.parse(output.trim()));
      } catch (error) {
        rejectWorker(
          new Error(
            `phase3 worker ${workerId} returned invalid output: ${String(error)} ${output}`,
          ),
        );
      }
    });
  });
}

async function removeTemporaryDirectory(directory) {
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
  throw lastError ?? new Error("temporary directory cleanup failed");
}

async function sameDatabaseConcurrencyScenario() {
  const directory = mkdtempSync(join(tmpdir(), "praxis-phase3-concurrency-"));
  const filename = join(directory, "events.db");
  try {
    const workers = await Promise.all(
      Array.from({ length: workerCount }, (_, index) =>
        runWorker(filename, index),
      ),
    );
    const store = new SqliteEventStore({ filename, migrationsDir });
    try {
      const events = store.getSince(0, 100);
      const residualEvents = events.filter(
        (event) => event.type === "residual.detected",
      );
      const proposalEvents = events.filter(
        (event) => event.type === "reflection.proposed",
      );
      if (
        events.length !== 3 ||
        residualEvents.length !== 1 ||
        proposalEvents.length !== 1 ||
        workers.filter((worker) => worker.residualInserted).length !== 1 ||
        workers.filter((worker) => worker.proposalInserted).length !== 1 ||
        workers.some((worker) => worker.decision !== "CONTINUE")
      ) {
        throw new Error(
          `phase3 concurrency mismatch: ${JSON.stringify({ events, workers })}`,
        );
      }
      return "same-db residual/reflection idempotency";
    } finally {
      store.close();
    }
  } finally {
    await removeTemporaryDirectory(directory);
  }
}

async function pureSafetyScenario() {
  const detector = new ResidualDetector();
  const controller = new ReflectionController();
  const field = {
    externalVerification: "strong",
    consequence: "low",
    reversibility: "easy",
    feedbackLatency: "short",
    actors: [{ type: "human", id: "phase3-user" }],
    explicitRules: [],
  };
  const exactOutcome = {
    expectation: {
      id: "phase3-safe-expectation",
      subject: { kind: "task", id: "phase3-task" },
      expected: { status: "complete" },
      verification: "exact",
      createdAt: "2026-09-14T00:00:00.000Z",
      evidence: [{ eventId: "phase3-safe-source", origin: "direct" }],
    },
    observation: {
      id: "phase3-safe-observation",
      subject: { kind: "task", id: "phase3-task" },
      actual: { status: "complete" },
      observedAt: "2026-09-14T00:00:09.000Z",
      evidence: [{ eventId: "phase3-safe-source", origin: "direct" }],
    },
    field,
    detectedAt: "2026-09-14T00:00:10.000Z",
  };
  const timingWithoutSubscription = {
    id: "phase3-safe-timing",
    subject: { kind: "agent", id: "phase3-agent" },
    agentId: "phase3-agent",
    cursorSeq: 1,
    latestRelevantSeq: 99,
    observedAt: "2026-09-14T00:00:00.000Z",
    detectedAt: "2026-09-14T00:01:00.000Z",
    subscribed: false,
    threshold: { minSeqLag: 1, maxStalenessMs: 1_000 },
    field,
    evidence: [{ eventId: "phase3-safe-source", origin: "direct" }],
  };
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      Promise.resolve({
        outcome: detector.detect({ outcomes: [exactOutcome] }),
        timing: detector.detect({ timings: [timingWithoutSubscription] }),
        reflection: controller.reflect({
          residual: {
            id: "phase3-safe-residual",
            kind: "outcome",
            observed: {
              kind: "task",
              id: "phase3-task",
              value: { status: "failed" },
            },
            field,
            confidence: 1,
            persistence: "transient",
            effect: "unknown",
            evidence: [{ eventId: "phase3-safe-source", origin: "direct" }],
            detectedAt: "2026-09-14T00:00:10.000Z",
          },
          budget: {
            maxDepth: 1,
            maxHypotheses: 1,
            maxToolCalls: 0,
            maxElapsedMs: 100,
          },
          newEvidenceAvailable: false,
        }),
      }),
    ),
  );
  if (
    results.some(
      (result) =>
        result.outcome.length !== 0 ||
        result.timing.length !== 0 ||
        result.reflection.decision !== "STOP" ||
        result.reflection.hypotheses.length !== 0,
    )
  ) {
    throw new Error(`phase3 pure safety mismatch: ${JSON.stringify(results)}`);
  }
  return "concurrent no-false-positive and no-self-call checks";
}

const results = await Promise.all([
  sameDatabaseConcurrencyScenario(),
  pureSafetyScenario(),
]);
log(`Phase 3 scenario PASS (${results.join(", ")}; concurrent runs)`);
