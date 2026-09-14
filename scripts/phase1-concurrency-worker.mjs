import { argv, stdout } from "node:process";

import { SqliteEventStore } from "../packages/store/dist/index.js";

const [, , filename, migrationsDir, workerId, countText] = argv;
const count = Number(countText);
if (
  filename === undefined ||
  migrationsDir === undefined ||
  workerId === undefined ||
  !Number.isSafeInteger(count) ||
  count < 1
) {
  throw new Error(
    "Usage: phase1-concurrency-worker <db> <migrations> <worker> <count>",
  );
}

const store = new SqliteEventStore({ filename, migrationsDir });
try {
  const sharedResult = store.append({
    schemaVersion: "1",
    eventVersion: "1",
    id: "concurrency-shared-event",
    type: "system.concurrency-probe",
    occurredAt: "2026-09-13T00:00:00.000Z",
    observedAt: "2026-09-13T00:00:00.000Z",
    recordedAt: "2026-09-13T00:00:00.000Z",
    actor: { type: "system", id: "phase1-concurrency" },
    operationId: "concurrency-shared-operation",
    source: { kind: "phase1-concurrency" },
    payload: { kind: "shared" },
    provenance: { origin: "direct", confidence: 1 },
  });

  let operationOnlyOutcome;
  try {
    const operationOnlyResult = store.append({
      schemaVersion: "1",
      eventVersion: "1",
      id: `concurrency-operation-only-${workerId}`,
      type: "system.concurrency-probe",
      occurredAt: "2026-09-13T00:00:00.000Z",
      observedAt: "2026-09-13T00:00:00.000Z",
      recordedAt: "2026-09-13T00:00:00.000Z",
      actor: { type: "agent", id: `operation-worker-${workerId}` },
      operationId: "concurrency-operation-only",
      source: { kind: "phase1-concurrency", ref: `worker-${workerId}` },
      payload: { kind: "operation-only", worker: workerId },
      provenance: { origin: "direct", confidence: 1 },
    });
    operationOnlyOutcome = operationOnlyResult.inserted ? "inserted" : "retry";
  } catch (error) {
    if (error?.code !== "OPERATION_ID_CONFLICT") throw error;
    operationOnlyOutcome = "conflict";
  }

  for (let index = 0; index < count; index += 1) {
    store.append({
      schemaVersion: "1",
      eventVersion: "1",
      id: `concurrency-unique-${workerId}-${index}`,
      type: "system.concurrency-probe",
      occurredAt: "2026-09-13T00:00:00.000Z",
      observedAt: "2026-09-13T00:00:00.000Z",
      recordedAt: "2026-09-13T00:00:00.000Z",
      actor: { type: "agent", id: `worker-${workerId}` },
      operationId: `concurrency-operation-${workerId}-${index}`,
      source: { kind: "phase1-concurrency", ref: `worker-${workerId}` },
      payload: { worker: workerId, index },
      provenance: { origin: "direct", confidence: 1 },
    });
  }

  stdout.write(
    `${JSON.stringify({ insertedShared: sharedResult.inserted, operationOnlyOutcome, workerId, count })}\n`,
  );
} finally {
  store.close();
}
