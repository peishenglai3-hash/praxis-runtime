#!/usr/bin/env node
/**
 * Phase 5 Legacy migration scenario.
 *
 * Runs the audited import under real contention: four independent processes
 * each scan the same corpus and attempt to record it at the same instant,
 * against one SQLite database. The expected outcome is that the corpus enters
 * the ledger exactly once, every losing process observes `already-imported`
 * rather than an error or a duplicate, doctor's legacy integrity check passes,
 * and a changed corpus produces a genuinely new run.
 */

import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { log } from "node:console";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { SqliteEventStore } from "../packages/store/dist/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const workerScript = join(scriptDir, "phase5-legacy-worker.mjs");
const migrationsDir = join(rootDir, "migrations");
const fixtureRoot = join(rootDir, "fixtures", "legacy");

const workerCount = 4;

function runWorker(corpusRoot, barrierDir, workerId) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      execPath,
      [
        workerScript,
        join(directory, "events.db"),
        migrationsDir,
        corpusRoot,
        barrierDir,
        String(workerId),
        String(workerCount),
      ],
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
            `phase5 worker ${workerId} failed (${code ?? "null"}/${signal ?? "none"}): ${errors}`,
          ),
        );
        return;
      }
      try {
        resolveWorker(JSON.parse(output.trim()));
      } catch (error) {
        rejectWorker(
          new Error(`phase5 worker output was invalid: ${String(error)}`),
        );
      }
    });
  });
}

let directory;
let runError;

try {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase5-legacy-"));
  const corpus = join(directory, "corpus");
  cpSync(fixtureRoot, corpus, { recursive: true });
  const corpusRoot = join(corpus, "data");
  const barrierDir = join(directory, "barrier");
  mkdirSync(barrierDir, { recursive: true });

  const results = await Promise.all(
    Array.from({ length: workerCount }, (_, index) =>
      runWorker(corpusRoot, barrierDir, index),
    ),
  );

  const inserted = results.filter((result) => result.inserted === true);
  const reused = results.filter(
    (result) => result.status === "already-imported",
  );
  if (inserted.length !== 1 || reused.length !== workerCount - 1) {
    throw new Error(
      `expected one inserting worker and ${workerCount - 1} idempotent replays, received ${JSON.stringify(results)}`,
    );
  }
  const runIds = new Set(results.map((result) => result.runId));
  if (runIds.size !== 1) {
    throw new Error(`workers disagreed about the run identity: ${[...runIds]}`);
  }

  const store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  try {
    const runs = store.listLegacyImportRuns();
    if (runs.length !== 1) {
      throw new Error(
        `expected exactly one recorded run, found ${runs.length}`,
      );
    }
    const [run] = runs;
    const declared = inserted[0];
    if (run.sourceFingerprint !== declared.fingerprint) {
      throw new Error("the recorded run does not match the inserted corpus");
    }

    // Every record entered the ledger exactly once.
    const expectedCounts = [
      ["legacy.signal.imported", run.counts.signals],
      ["legacy.pattern.imported", run.counts.patterns],
      ["legacy.graph-edge.imported", run.counts.graphEdges],
      ["legacy.import.completed", 1],
    ];
    for (const [type, expected] of expectedCounts) {
      const actual = store.query({ type }).length;
      if (actual !== expected) {
        throw new Error(
          `ledger holds ${actual} ${type} record(s); the run declares ${expected}`,
        );
      }
    }

    const issues = store.getLegacyIntegrityIssues();
    if (issues.length !== 0) {
      throw new Error(
        `legacy integrity issues after a concurrent import: ${JSON.stringify(issues)}`,
      );
    }

    // A changed corpus must produce a genuinely new run rather than folding
    // into the first one.
    writeFileSync(
      join(corpusRoot, "notes", "later.txt"),
      "material added after the first import\n",
    );
    const second = await runWorker(corpusRoot, barrierDir, workerCount);
    if (
      second.inserted !== true ||
      second.fingerprint === run.sourceFingerprint
    ) {
      throw new Error(
        `a changed corpus did not produce a new run: ${JSON.stringify(second)}`,
      );
    }
    if (store.listLegacyImportRuns().length !== 2) {
      throw new Error(
        "expected exactly two recorded runs after a corpus change",
      );
    }

    log(
      `Phase 5 Legacy scenario PASS (${inserted.length} inserting worker, ${reused.length} idempotent replays, ${run.counts.anomalies} anomalies, 2 runs)`,
    );
  } finally {
    store.close();
  }
} catch (error) {
  runError = error;
}

let cleanupError;
if (directory !== undefined) {
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
}

if (runError !== undefined) throw runError;
if (cleanupError !== undefined) throw cleanupError;
