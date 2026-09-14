import { log } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SqliteEventStore } from "../packages/store/dist/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const migrationsDir = join(rootDir, "migrations");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "praxis-phase1-throughput-"),
);
const filename = join(temporaryDirectory, "events.db");
const count = 10_000;

let store;
let failure;
try {
  store = new SqliteEventStore({ filename, migrationsDir });
  const startedAt = performance.now();
  for (let index = 0; index < count; index += 1) {
    const result = store.append({
      schemaVersion: "1",
      eventVersion: "1",
      id: `throughput-event-${index}`,
      type: "system.throughput-probe",
      occurredAt: "2026-09-13T00:00:00.000Z",
      observedAt: "2026-09-13T00:00:00.000Z",
      recordedAt: "2026-09-13T00:00:00.000Z",
      actor: { type: "system", id: "phase1-throughput" },
      sessionId: `throughput-session-${index % 10}`,
      traceId: `throughput-trace-${index % 100}`,
      operationId: `throughput-operation-${index}`,
      source: { kind: "phase1-throughput", ref: `row-${index}` },
      payload: { index },
      provenance: { origin: "direct", confidence: 1 },
    });
    if (!result.inserted || result.record.seq !== index + 1) {
      throw new Error(`10k append invariant failed at index ${index}`);
    }
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  const rows = store.query({
    afterSeq: 0,
    beforeSeq: count + 1,
    type: "system.throughput-probe",
    sessionId: "throughput-session-0",
    actor: { type: "system", id: "phase1-throughput" },
    limit: count,
  });
  if (store.getLastSeq() !== count || rows.length !== count / 10) {
    throw new Error(
      `10k verification mismatch: lastSeq=${store.getLastSeq()} filteredRows=${rows.length}`,
    );
  }
  if (store.getByOperationId("throughput-operation-9999").length !== 1) {
    throw new Error("10k operation lookup invariant failed");
  }
  log(`Phase 1 throughput PASS (${count} appends, ${elapsedMs} ms)`);
} catch (error) {
  failure = error;
} finally {
  try {
    store?.close();
  } finally {
    rmSync(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

if (failure !== undefined) throw failure;
