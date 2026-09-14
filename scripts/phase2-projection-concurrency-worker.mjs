import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { argv, stdout } from "node:process";

import {
  ProjectionEngine,
  createProjectProjection,
} from "../packages/state/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const [filename, migrationsDir, barrierDirectory, workerId] = argv.slice(2);
if (
  filename === undefined ||
  migrationsDir === undefined ||
  barrierDirectory === undefined ||
  workerId === undefined
) {
  throw new Error(
    "usage: phase2-projection-concurrency-worker <db> <migrations> <barrier> <workerId>",
  );
}

const store = new SqliteEventStore({ filename, migrationsDir });
try {
  const readyFile = `${barrierDirectory}/${workerId}.ready`;
  writeFileSync(readyFile, "ready");
  let released = false;
  for (let attempt = 0; attempt < 1_500; attempt += 1) {
    if (existsSync(`${barrierDirectory}/go`)) {
      released = true;
      break;
    }
    await delay(10);
  }
  if (!released) throw new Error("phase2 projection worker barrier timed out");

  const firstEvent = store.getSince(0, 1)[0];
  if (firstEvent === undefined)
    throw new Error("phase2 projection ledger is empty");
  let casOutcome;
  try {
    store.saveProjectionState(
      {
        projectionName: "project",
        projectionVersion: 1,
        lastSeq: firstEvent.seq,
        state: {
          eventCount: 1,
          lastSeq: firstEvent.seq,
          lastEventType: firstEvent.type,
        },
        updatedAt: Date.parse(firstEvent.recordedAt),
      },
      0,
    );
    casOutcome = "inserted";
  } catch (error) {
    if (error instanceof Error && error.message.includes("compare-and-set")) {
      casOutcome = "conflict";
    } else {
      throw error;
    }
  }

  const engine = new ProjectionEngine(store, store, 2);
  let result;
  let attempts = 0;
  do {
    result = engine.catchUp(createProjectProjection());
    attempts += 1;
    if (result.status !== "caught_up") await delay(25);
  } while (result.status !== "caught_up" && attempts < 20);
  if (result.status !== "caught_up") {
    throw new Error(
      `projection worker could not catch up: ${JSON.stringify(result)}`,
    );
  }
  stdout.write(JSON.stringify({ status: result.status, attempts, casOutcome }));
} finally {
  store.close();
}
