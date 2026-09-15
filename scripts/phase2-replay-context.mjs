import { log } from "node:console";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { clearTimeout, setTimeout as setTimer } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ContextPlanner } from "../packages/context/dist/index.js";
import { Phase2Runtime } from "../packages/runtime/dist/index.js";
import {
  ProjectionEngine,
  createAgentProjection,
  createAssetProjection,
  createProjectProjection,
  createRuleProjection,
} from "../packages/state/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const writer = {
  writerId: "system:phase2-scenario",
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

const appendEvent = (store, event) => store.append(event, writer);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const migrationsDir = join(rootDir, "migrations");
const projectionWorkerScript = join(
  scriptDir,
  "phase2-projection-concurrency-worker.mjs",
);

function makeEvent(id, type, payload) {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type,
    occurredAt: "2026-09-14T00:00:00.000Z",
    observedAt: "2026-09-14T00:00:01.000Z",
    recordedAt: "2026-09-14T00:00:02.000Z",
    actor: { type: "system", id: "phase2-scenario" },
    source: { kind: "phase2-scenario", ref: id },
    payload,
    provenance: { origin: "direct", confidence: 1 },
  };
}

async function replayScenario() {
  const directory = mkdtempSync(join(tmpdir(), "praxis-phase2-replay-"));
  const store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  try {
    appendEvent(
      store,
      makeEvent("scenario-rule", "rule.registered", { id: "rule-1" }),
    );
    appendEvent(
      store,
      makeEvent("scenario-asset", "asset.candidate", {
        id: "asset-1",
        revision: 1,
      }),
    );
    appendEvent(
      store,
      makeEvent("scenario-agent", "agent.cursor.updated", {
        agentId: "agent-1",
        lastSeq: 2,
        revision: 1,
      }),
    );
    const engine = new ProjectionEngine(store, store, 2);
    const results = [
      engine.rebuild(createProjectProjection()),
      engine.rebuild(createRuleProjection()),
      engine.rebuild(createAssetProjection()),
      engine.rebuild(createAgentProjection()),
    ];
    if (results.some((result) => result.status !== "caught_up")) {
      throw new Error(`projection replay failed: ${JSON.stringify(results)}`);
    }
    const before = store.getProjectionState("project");
    store.clearProjectionData("project");
    const rebuilt = engine.rebuild(createProjectProjection());
    const after = store.getProjectionState("project");
    if (
      rebuilt.status !== "caught_up" ||
      JSON.stringify(before?.state) !== JSON.stringify(after?.state) ||
      before?.lastSeq !== after?.lastSeq
    ) {
      throw new Error("projection rebuild was not deterministic");
    }
    return "replay/rebuild";
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function contextScenario() {
  const directory = mkdtempSync(join(tmpdir(), "praxis-phase2-context-"));
  const store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  try {
    appendEvent(
      store,
      makeEvent("scenario-rule", "rule.registered", { id: "rule-1" }),
    );
    appendEvent(
      store,
      makeEvent("scenario-asset", "asset.candidate", {
        id: "asset-1",
        revision: 1,
      }),
    );
    let id = 0;
    const runtime = new Phase2Runtime(
      {
        events: store,
        projections: store,
        clock: { now: () => new Date("2026-09-14T00:00:00.000Z") },
        ids: { next: () => `scenario-context-${++id}` },
        actor: { type: "system", id: "phase2-scenario" },
        writer,
      },
      new ContextPlanner(),
    );
    const candidates = [
      {
        id: "context-a",
        sourceEventId: "scenario-rule",
        seq: 1,
        text: "active rule",
        taskRelevance: 1,
        projectRelevance: 0.8,
        recency: 0.8,
        explicitPriority: 0.9,
        activeRuleRelevance: 1,
        sourceOrigin: "direct",
      },
      {
        id: "context-b",
        sourceEventId: "scenario-asset",
        seq: 2,
        text: "candidate asset",
        taskRelevance: 0.6,
        projectRelevance: 1,
        recency: 0.7,
        explicitPriority: 0.5,
        activeRuleRelevance: 0.3,
        sourceOrigin: "direct",
      },
    ];
    const plan = runtime.buildContextPlan({
      mode: "refresh",
      candidates,
      refreshCandidates: candidates,
      budget: { maxItems: 2, maxTokens: 100 },
      stateSeq: 2,
      planId: "scenario-plan",
    });
    if (plan.selected.length !== 2 || plan.reasons.length !== 2) {
      throw new Error("context plan selection/reason mismatch");
    }
    runtime.recordContextPlan(plan);
    for (const proposal of plan.exposureProposals) {
      runtime.recordContextExposure(proposal, plan.planId);
    }
    const exposureCount = store.query({ type: "context.item.exposed" }).length;
    if (exposureCount !== plan.selected.length) {
      throw new Error(`exposure count mismatch: ${exposureCount}`);
    }
    return "context/mode/exposure";
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function runProjectionWorker(filename, barrierDirectory, workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [
        projectionWorkerScript,
        filename,
        migrationsDir,
        barrierDirectory,
        String(workerId),
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
    const timeout = setTimer(() => {
      child.kill();
      rejectWorker(new Error("phase2 projection worker timed out"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectWorker(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectWorker(
          new Error(
            `phase2 projection worker failed with code ${code ?? "null"} signal ${signal ?? "none"}: ${errorOutput}`,
          ),
        );
        return;
      }
      try {
        resolveWorker(JSON.parse(output.trim()));
      } catch (error) {
        rejectWorker(
          new Error(
            `phase2 projection worker returned invalid output: ${String(error)} ${output}`,
          ),
        );
      }
    });
  });
}

async function sameDatabaseProjectionScenario() {
  const directory = mkdtempSync(join(tmpdir(), "praxis-phase2-projection-"));
  const filename = join(directory, "events.db");
  const barrierDirectory = join(directory, "barrier");
  mkdirSync(barrierDirectory);
  const store = new SqliteEventStore({ filename, migrationsDir });
  try {
    for (let index = 1; index <= 12; index += 1) {
      appendEvent(
        store,
        makeEvent(`projection-concurrency-${index}`, "interaction.recorded", {
          index,
        }),
      );
    }
  } finally {
    store.close();
  }

  try {
    const workerPromises = [
      runProjectionWorker(filename, barrierDirectory, 1),
      runProjectionWorker(filename, barrierDirectory, 2),
    ];
    let ready = false;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const readyCount = readdirSync(barrierDirectory).filter((name) =>
        name.endsWith(".ready"),
      ).length;
      if (readyCount === 2) {
        ready = true;
        break;
      }
      await delay(10);
    }
    if (!ready)
      throw new Error("phase2 projection workers did not become ready");
    writeFileSync(join(barrierDirectory, "go"), "go");
    const workers = await Promise.all(workerPromises);
    const finalStore = new SqliteEventStore({ filename, migrationsDir });
    try {
      const finalEngine = new ProjectionEngine(finalStore, finalStore);
      const finalResult = finalEngine.catchUp(createProjectProjection());
      const state = finalStore.getProjectionState("project");
      if (
        workers.filter((worker) => worker.casOutcome === "inserted").length !==
          1 ||
        workers.filter((worker) => worker.casOutcome === "conflict").length !==
          1 ||
        workers.some((worker) => worker.status !== "caught_up") ||
        finalResult.status !== "caught_up" ||
        state?.lastSeq !== 12 ||
        state.state.eventCount !== 12
      ) {
        throw new Error(
          `same-db projection mismatch: ${JSON.stringify({ workers, finalResult, state })}`,
        );
      }
      return "same-db projection concurrency";
    } finally {
      finalStore.close();
    }
  } finally {
    await delay(10);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

const results = await Promise.all([
  replayScenario(),
  contextScenario(),
  sameDatabaseProjectionScenario(),
]);
log(`Phase 2 scenario PASS (${results.join(", ")}; concurrent runs)`);
