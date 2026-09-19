#!/usr/bin/env node
/**
 * Phase 5 concurrent Legacy import worker.
 *
 * Each worker independently scans the same corpus, then waits on a shared
 * barrier so that every process attempts the import at the same moment. The
 * property under test is that the ledger records the corpus once, no matter
 * how many processes raced to record it.
 *
 * Usage:
 *   node scripts/phase5-legacy-worker.mjs <db> <migrationsDir> <corpusRoot> \
 *     <barrierDir> <workerId> <totalWorkers> [variantPath]
 */

import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

import { legacyImportRunId } from "../packages/contracts/dist/index.js";
import {
  buildLegacyImportEvents,
  buildLegacyMigrationPlan,
  legacyImporterWriterContext,
  NodeLegacyFileSystem,
} from "../packages/runtime/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const [
  filename,
  migrationsDir,
  corpusRoot,
  barrierDir,
  workerIdRaw,
  totalWorkersRaw,
] = process.argv.slice(2);

const workerId = Number.parseInt(workerIdRaw ?? "0", 10);
const totalWorkers = Number.parseInt(totalWorkersRaw ?? "4", 10);

// Scan before the barrier so the race is on the write, not on the read.
const plan = buildLegacyMigrationPlan({
  roots: [corpusRoot],
  fileSystem: new NodeLegacyFileSystem(),
});
const startedAt = new Date().toISOString();

writeFileSync(`${barrierDir}/arrived-${workerId}`, String(Date.now()));
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  let arrived = 0;
  for (let index = 0; index < totalWorkers; index += 1) {
    if (existsSync(`${barrierDir}/arrived-${index}`)) arrived += 1;
  }
  if (arrived >= totalWorkers) break;
  await delay(10);
}

const events = buildLegacyImportEvents({
  plan,
  actor: { type: "system", id: "phase5-worker" },
  recordedAt: startedAt,
  archiveEntryCount: 0,
});

const store = new SqliteEventStore({ filename, migrationsDir });
try {
  const result = store.recordLegacyImport(
    {
      report: {
        runId: legacyImportRunId(plan.sourceFingerprint, plan.planHash),
        status: "applied",
        planHash: plan.planHash,
        sourceFingerprint: plan.sourceFingerprint,
        root: plan.root,
        counts: plan.counts,
        anomalySummary: summarise(plan.inventory.anomalies),
        archive: null,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      inventory: plan.inventory.entries,
      anomalies: plan.inventory.anomalies,
      events,
    },
    legacyImporterWriterContext,
  );

  process.stdout.write(
    `${JSON.stringify({
      workerId,
      inserted: result.inserted,
      status: result.run.status,
      runId: result.run.runId,
      appendedEvents: result.appendedEvents,
      eventCount: events.length,
      fingerprint: plan.sourceFingerprint,
      lastSeq: result.lastSeq,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      workerId,
      error: error instanceof Error ? error.message : String(error),
      code:
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined,
    })}\n`,
  );
  process.exitCode = 2;
} finally {
  store.close();
}

function summarise(anomalies) {
  const counts = new Map();
  for (const anomaly of anomalies) {
    counts.set(
      anomaly.class,
      (counts.get(anomaly.class) ?? 0) + anomaly.affectedCount,
    );
  }
  return [...counts.entries()]
    .map(([anomalyClass, count]) => ({ class: anomalyClass, count }))
    .sort((left, right) => (left.class < right.class ? -1 : 1));
}
